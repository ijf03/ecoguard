import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { SNSClient, CreateTopicCommand, SubscribeCommand, GetSubscriptionAttributesCommand, PublishCommand, DeleteTopicCommand, SetSubscriptionAttributesCommand } from '@aws-sdk/client-sns';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CloudNotifications } from '../../src/cloud/notifications.js';
import { FirestoreMediaStore } from '../../src/cloud/firestore-media.js';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Requires the loopback Firestore emulator.');
test('notification outbox filters tags and private owners, verifies account email, fences duplicate delivery and cleans deletion records', async t => {
  const db = new Firestore({ projectId: 'demo-ecoguard-g80' });
  t.after(async () => { for (const name of ['subscriptions', 'deliveries', 'outbox', 'media', 'checksums', 'tombstones', 'control']) await db.recursiveDelete(db.collection('ecoguard_' + name)); await db.terminate(); });
  const sns = new SNSClient({ region: 'us-east-1' }); const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });
  t.after(() => { sns.destroy(); cognito.destroy(); });
  const published: { TopicArn: string; Message: string }[] = [];
  const policies: string[] = [];
  Object.assign(cognito, { send: async (command: { input: { AccessToken: string } }) => ({ UserAttributes: [{ Name: 'sub', Value: command.input.AccessToken }, { Name: 'email', Value: command.input.AccessToken + '@example.invalid' }, { Name: 'email_verified', Value: 'true' }] }) });
  Object.assign(sns, { send: async (command: unknown) => {
    if (command instanceof CreateTopicCommand) return { TopicArn: 'arn:aws:sns:us-east-1:851725503164:' + command.input.Name };
    if (command instanceof SubscribeCommand) { policies.push(command.input.Attributes!.FilterPolicy!); assert.match(command.input.Endpoint!, /@example.invalid$/); return { SubscriptionArn: command.input.TopicArn + ':fixture' }; }
    if (command instanceof GetSubscriptionAttributesCommand) return { Attributes: { PendingConfirmation: 'false' } };
    if (command instanceof PublishCommand) { published.push(command.input as { TopicArn: string; Message: string }); return { MessageId: 'fixture-' + published.length }; }
    if (command instanceof DeleteTopicCommand || command instanceof SetSubscriptionAttributesCommand) return {};
    throw new Error('Unexpected SNS command.');
  } });
  const notifications = new CloudNotifications(db, sns, cognito, 'https://ecoguard.test');
  await assert.rejects(notifications.subscribe('alice', 'bob', ['dog']), { status: 403 });
  await notifications.subscribe('alice', 'alice', ['dog']); await notifications.subscribe('charlie', 'charlie', ['dog']); await notifications.subscribe('bob', 'bob', ['cat']);
  assert.deepEqual(JSON.parse(policies[0]!), { tags: ['dog'] });
  const alice = (await db.collection('ecoguard_subscriptions').where('ownerId', '==', 'alice').get()).docs[0]!.data();
  const charlie = (await db.collection('ecoguard_subscriptions').where('ownerId', '==', 'charlie').get()).docs[0]!.data();
  assert.equal(alice.email, undefined);
  const store = new FirestoreMediaStore(db);
  async function media(owner: string, visibility: 'public' | 'private', checksum: string) {
    const item = (await store.reserve(owner, { filename: 'synthetic-notification.png', size: 100, checksum: checksum.repeat(64), contentType: 'image/png', visibility })).media;
    await store.bindSource(item.id, { key: item.storageKey, version: 'v1', checksum: item.checksum, size: item.size, contentType: item.contentType });
    const ticket = (await store.claim(item.id, 'a'.repeat(64)))!;
    await store.complete(ticket, { species: { dog: 1 }, model: { identity: 'fixture', version: '1', weightsSha256: 'a'.repeat(64), confidence: .25 } }, { key: `thumbnails/${item.id}/${ticket.token}/preview.jpg`, width: 100, height: 100, originalWidth: 100, originalHeight: 100 });
    return item;
  }
  const privateAlice = await media('alice', 'private', 'a');
  const publicBob = await media('bob', 'public', 'b');
  await media('bob', 'private', 'c');
  await Promise.all([notifications.deliver(), notifications.deliver()]);
  assert.equal(published.length, 3);
  const privateMessages = published.filter(message => message.Message.includes(privateAlice.id));
  assert.deepEqual(privateMessages.map(message => message.TopicArn), [alice.topicArn]);
  assert.deepEqual(published.filter(message => message.Message.includes(publicBob.id)).map(message => message.TopicArn).sort(), [alice.topicArn, charlie.topicArn].sort());
  await notifications.deliver(); assert.equal(published.length, 3);
  await store.editTags([publicBob.id], ['collar'], 1, 'bob'); await notifications.deliver();
  assert.equal(published.length, 5); assert.match(published[4]!.Message, /updated sighting/);
  await store.editTags([publicBob.id], ['unassigned-tag'], 0, 'bob'); await notifications.deliver();
  assert.equal(published.length, 5); // A no-op tag edit must not create a misleading update alert.
  await store.beginDelete([publicBob.id], 'bob'); await store.finishDelete(publicBob.id);
  assert.equal((await db.collection('ecoguard_deliveries').where('mediaId', '==', publicBob.id).get()).size, 0);
  await notifications.unsubscribe('alice'); assert.equal((await notifications.status('alice')).enabled, false);
});
