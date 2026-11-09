import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreMediaStore } from '../../src/cloud/firestore-media.js';
import { createRecovery } from '../../src/cloud/recovery.js';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Requires loopback Firestore emulator.');
test('recovery resumes cleanup, expires only proven-missing uploads, preserves permission failures and removes quiet-period jobs', async t => {
  const db = new Firestore({ projectId: 'demo-ecoguard-g80' });
  const namespace = `recovery_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => { for (const name of ['media', 'checksums', 'outbox', 'tombstones', 'control']) await db.recursiveDelete(db.collection(`${namespace}_${name}`)); await db.terminate(); });
  let now = Date.now();
  const store = new FirestoreMediaStore(db, namespace, () => now);
  const reserve = async (owner: string) => (await store.reserve(owner, { filename: 'fixture.png', checksum: 'a'.repeat(64), size: 100, contentType: 'image/png', visibility: 'private' })).media;
  const absent = await reserve('absent');
  const protectedItem = await reserve('permission-failure');
  const uploaded = await reserve('uploaded');
  const ready = await reserve('ready');
  await store.bindSource(ready.id, { key: ready.storageKey, version: 'fixture-version', checksum: ready.checksum, size: ready.size, contentType: ready.contentType });
  const deleting = await reserve('deleting');
  await store.editTags([deleting.id], ['cat'], 1, deleting.ownerId);
  await store.beginDelete([deleting.id], deleting.ownerId);
  now += 16 * 60_000;
  const queued: string[] = [];
  const cleaned: string[] = [];
  let deny = true;
  let failCleanup = true;
  const recover = createRecovery({ store, now: () => now, enqueue: async id => { queued.push(id); }, storage: {
    head: async item => {
      if (item.id === protectedItem.id && deny) throw Object.assign(new Error('Access denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
      if (item.id !== uploaded.id) throw Object.assign(new Error('Not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return { version: 'real-object-version-fixture', size: item.size, checksum: item.checksum, contentType: item.contentType };
    },
    cleanup: async item => {
      if (item.id === deleting.id && failCleanup) { failCleanup = false; throw new Error('Transient storage failure'); }
      cleaned.push(item.id);
    },
  } });
  await assert.rejects(recover(), /retained state/);
  await assert.rejects(store.get(absent.id, 'absent'), { status: 404 });
  assert.equal((await store.get(protectedItem.id, 'permission-failure')).phase, 'awaiting-upload');
  assert.equal((await store.readForWorker(deleting.id))!.phase, 'deleting');
  assert.ok(queued.includes(ready.id)); assert.ok(queued.includes(uploaded.id));
  assert.equal(cleaned.includes(protectedItem.id), false);
  deny = false;
  await recover();
  assert.equal((await db.collection(`${namespace}_media`).doc(deleting.id).get()).exists, false);
  assert.equal((await db.collection(`${namespace}_outbox`).where('mediaId', '==', deleting.id).get()).size, 0);
  const tomb = await store.readForWorker(absent.id);
  assert.equal(tomb!.phase, 'deleted');
  assert.deepEqual(Object.keys(tomb!).sort(), ['cleanupAfter', 'id', 'phase', 'storageKey']); // No filename, tags, owner or content metadata retained.
  now += 3 * 60_000;
  await recover();
  assert.equal(await store.readForWorker(absent.id), undefined);
  assert.equal(await store.readForWorker(deleting.id), undefined);
});
