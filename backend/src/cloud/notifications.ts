import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Firestore } from '@google-cloud/firestore';
import { CreateTopicCommand, DeleteTopicCommand, GetSubscriptionAttributesCommand, PublishCommand, SetSubscriptionAttributesCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { CognitoIdentityProviderClient, GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ApiError } from '../http/errors.js';
import { tagName } from '../media/search.js';
import type { CloudMedia } from './firestore-media.js';

interface Subscription { ownerId: string; tags: string[]; topicArn: string; subscriptionArn: string; emailHash: string; createdAt: string; active: boolean }
interface Outbox { mediaId: string; ownerId: string; revision: number; kind: 'upload' | 'update'; createdAt: string }
export interface Notifications {
  status(owner: string): Promise<{ enabled: boolean; pending: boolean; tags: string[] }>;
  subscribe(owner: string, token: string, tags: unknown): Promise<{ enabled: boolean; pending: boolean; tags: string[] }>;
  unsubscribe(owner: string): Promise<void>;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const missing = (error: unknown) => (error as { name?: string }).name === 'NotFoundException' || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

export class CloudNotifications implements Notifications {
  constructor(private readonly db: Firestore, private readonly sns: SNSClient, private readonly cognito: CognitoIdentityProviderClient, private readonly origin: string) {}
  private subscriptions() { return this.db.collection('ecoguard_subscriptions'); }
  private subscription(owner: string) { return this.subscriptions().doc(hash(owner)); }
  private async markEvent(id: string, state: string) {
    const ref = this.db.collection('ecoguard_outbox').doc(id);
    await this.db.runTransaction(async tx => { if ((await tx.get(ref)).exists) tx.update(ref, { state }); });
  }
  private async confirmed(subscription: Subscription) {
    try {
      const result = await this.sns.send(new GetSubscriptionAttributesCommand({ SubscriptionArn: subscription.subscriptionArn }));
      return result.Attributes?.PendingConfirmation === 'false';
    } catch (error) { if (missing(error)) return false; throw error; }
  }
  async status(owner: string) {
    const subscription = (await this.subscription(owner).get()).data() as Subscription | undefined;
    if (!subscription?.active) return { enabled: false, pending: false, tags: [] };
    return { enabled: true, pending: !await this.confirmed(subscription), tags: subscription.tags };
  }
  async subscribe(owner: string, token: string, value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 20) throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'Choose 1–20 species or tags to watch.');
    const tags = [...new Set(value.map(tagName))];
    const user = await this.cognito.send(new GetUserCommand({ AccessToken: token }));
    const attributes = Object.fromEntries((user.UserAttributes ?? []).map(item => [item.Name!, item.Value]));
    if (attributes.sub !== owner || attributes.email_verified !== 'true' || !attributes.email) throw new ApiError(403, 'EMAIL_UNVERIFIED', 'Verify your account email before subscribing.');
    const emailHash = hash(attributes.email);
    const ref = this.subscription(owner);
    const existing = (await ref.get()).data() as Subscription | undefined;
    const policy = JSON.stringify({ tags });
    if (existing?.active && existing.emailHash === emailHash) {
      if (JSON.stringify(existing.tags) !== JSON.stringify(tags)) {
        await this.sns.send(new SetSubscriptionAttributesCommand({ SubscriptionArn: existing.subscriptionArn, AttributeName: 'FilterPolicy', AttributeValue: policy }));
        await ref.update({ tags, createdAt: new Date().toISOString() });
      }
      return this.status(owner);
    }
    if (existing?.active) { await ref.update({ active: false }); await this.sns.send(new DeleteTopicCommand({ TopicArn: existing.topicArn })); }
    const topic = await this.sns.send(new CreateTopicCommand({ Name: 'ecoguard-g80-alerts-' + hash(owner).slice(0, 24), Tags: [{ Key: 'Project', Value: 'AussieEcoGuardG80' }] }));
    if (!topic.TopicArn) throw new Error('Notification topic was not created.');
    const subscribed = await this.sns.send(new SubscribeCommand({ TopicArn: topic.TopicArn, Protocol: 'email', Endpoint: attributes.email, ReturnSubscriptionArn: true,
      Attributes: { FilterPolicy: policy, FilterPolicyScope: 'MessageAttributes' } }));
    if (!subscribed.SubscriptionArn || !subscribed.SubscriptionArn.startsWith(topic.TopicArn + ':')) throw new Error('Notification subscription was not created.');
    await ref.set({ ownerId: owner, emailHash, tags, topicArn: topic.TopicArn, subscriptionArn: subscribed.SubscriptionArn, createdAt: new Date().toISOString(), active: true } satisfies Subscription);
    return this.status(owner);
  }
  async unsubscribe(owner: string) {
    const ref = this.subscription(owner);
    const item = (await ref.get()).data() as Subscription | undefined;
    if (!item) return;
    await ref.update({ active: false }); // Stop new deliveries before removing the dedicated topic.
    await this.sns.send(new DeleteTopicCommand({ TopicArn: item.topicArn }));
    await ref.delete();
  }
  /** At-least-once outbox delivery; claims fence concurrent publishers, SNS may still redeliver. */
  async deliver() {
    const events = await this.db.collection('ecoguard_outbox').where('state', '==', 'pending').orderBy(FieldPath.documentId()).limit(25).get();
    const subscribers: Subscription[] = [];
    let cursor: string | undefined;
    do {
      const query = this.subscriptions().where('active', '==', true).orderBy(FieldPath.documentId()).limit(100);
      const page = await (cursor ? query.startAfter(cursor) : query).get();
      subscribers.push(...page.docs.map(doc => doc.data() as Subscription));
      cursor = page.size === 100 ? page.docs.at(-1)!.id : undefined;
    } while (cursor);
    let published = 0;
    for (const event of events.docs) {
      const data = event.data() as Outbox;
      const mediaRef = this.db.collection('ecoguard_media').doc(data.mediaId);
      const media = (await mediaRef.get()).data() as CloudMedia | undefined;
      if (!media?.sourceVersion || ['rejected', 'deleting', 'deleted'].includes(media.phase) || media.revision !== data.revision) { await this.markEvent(event.id, 'superseded'); continue; }
      const tags = [...new Set([...Object.keys(media.species), ...media.manualTags])];
      let pending = false;
      for (const subscriber of subscribers) {
        if (subscriber.createdAt > data.createdAt || media.visibility !== 'public' && subscriber.ownerId !== media.ownerId || !subscriber.tags.some(tag => tags.includes(tag))) continue;
        if (!await this.confirmed(subscriber)) continue;
        const delivery = this.db.collection('ecoguard_deliveries').doc(event.id + '_' + hash(subscriber.ownerId));
        const claim = randomUUID();
        const accepted = await this.db.runTransaction(async tx => {
          const previous = (await tx.get(delivery)).data();
          if (previous?.state === 'sent') return 'sent';
          if (previous?.until > Date.now()) return 'busy';
          tx.set(delivery, { mediaId: media.id, state: 'sending', token: claim, until: Date.now() + 120000 }); return 'claimed';
        });
        if (accepted === 'sent') continue;
        if (accepted === 'busy') { pending = true; continue; }
        try {
          // Recheck deletion, privacy and the user's opt-in just before publishing.
          const latest = (await mediaRef.get()).data() as CloudMedia | undefined;
          const preference = (await this.subscription(subscriber.ownerId).get()).data() as Subscription | undefined;
          if (!latest || ['rejected', 'deleting', 'deleted'].includes(latest.phase) || latest.revision !== data.revision || latest.visibility !== 'public' && latest.ownerId !== subscriber.ownerId || !preference?.active || !preference.tags.some(tag => tags.includes(tag))) {
            await delivery.delete(); continue;
          }
          const result = await this.sns.send(new PublishCommand({ TopicArn: subscriber.topicArn, Subject: `EcoGuard: matching sighting ${data.kind === 'upload' ? 'added' : 'updated'}`,
            Message: `${data.kind === 'upload' ? 'A new sighting' : 'An updated sighting'} matches your watched tags.\n\n${media.filename}\nTags: ${tags.join(', ')}\n\nView securely: ${this.origin}/?sighting=${media.id}\n\nSign in to view. Manage your watched tags or unsubscribe in EcoGuard → Email alerts.`,
            MessageAttributes: { tags: { DataType: 'String.Array', StringValue: JSON.stringify(tags) } } }));
          await this.db.runTransaction(async tx => { const current = (await tx.get(delivery)).data(); if (current?.token === claim) tx.set(delivery, { mediaId: media.id, state: 'sent', messageId: result.MessageId ?? null }); });
          published++;
        } catch (error) {
          await this.db.runTransaction(async tx => { const current = (await tx.get(delivery)).data(); if (current?.token === claim) tx.update(delivery, { until: 0 }); });
          throw error;
        }
      }
      if (!pending) await this.markEvent(event.id, 'delivered');
    }
    return { inspected: events.size, published };
  }
}
