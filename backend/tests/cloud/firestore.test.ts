import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreMediaStore, type CloudMedia, type ProcessingTicket } from '../../src/cloud/firestore-media.js';

// Explicit emulator-only suite. Missing prerequisites fail instead of silently skipping.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('Start the Firestore emulator and set FIRESTORE_EMULATOR_HOST=127.0.0.1:8088. This suite never targets a live database.');
}
const projectId = 'demo-ecoguard-g80';
const checksum = 'a'.repeat(64);
const modelSha256 = 'b'.repeat(64);
const input = { filename: 'cat.png', checksum, size: 100, contentType: 'image/png', visibility: 'private' } as const;
const detection = { species: { cat: 2 }, model: { identity: 'fixture detector, not real inference', version: '1', weightsSha256: modelSha256, confidence: 0.25 } };
function setup(t: TestContext) {
  const db = new Firestore({ projectId });
  const namespace = `test_${randomUUID().replaceAll('-', '')}`;
  let now = Date.now();
  const store = new FirestoreMediaStore(db, namespace, () => now);
  t.after(async () => {
    for (const name of ['media', 'checksums', 'outbox']) await db.recursiveDelete(db.collection(`${namespace}_${name}`));
    await db.terminate();
  });
  return { db, store, namespace, advance: (ms: number) => { now += ms; } };
}
function source(item: CloudMedia, version = 's3-version-1') {
  return { key: item.storageKey, version, checksum: item.checksum, size: item.size, contentType: item.contentType };
}
const thumbnail = (ticket: ProcessingTicket) => ({ key: `thumbnails/${ticket.id}/${ticket.token}/preview.jpg`, width: 320, height: 200, originalWidth: 960, originalHeight: 600 });

test('Firestore transactions deduplicate concurrent same-owner reservations without leaking another owner', async t => {
  const { store } = setup(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => store.reserve('alice', input)));
  assert.equal(new Set(results.map(r => r.media.id)).size, 1);
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  const bob = await store.reserve('bob', input);
  assert.notEqual(bob.media.id, results[0]!.media.id);
  assert.notEqual(bob.media.storageKey, results[0]!.media.storageKey);
  await assert.rejects(store.get(bob.media.id, 'alice'), { status: 404 });
  await assert.rejects(store.reserve('', input), { status: 401 });
});

test('expired upload reservations retire old immutable keys without releasing a newer checksum reservation', async t => {
  const { store, advance } = setup(t);
  const old = (await store.reserve('alice', input)).media;
  advance(16 * 60_000);
  const fresh = (await store.reserve('alice', input)).media;
  assert.notEqual(old.id, fresh.id);
  assert.notEqual(old.storageKey, fresh.storageKey);
  assert.equal(await store.bindSource(old.id, source(old)), false);
  await assert.rejects(store.get(old.id, 'alice'), { status: 404 });
  assert.equal(await store.finishDelete(old.id), true);
  assert.equal((await store.reserve('alice', input)).media.id, fresh.id);
});

test('trusted object binding verifies reservation values, pins a source version and ignores duplicate events', async t => {
  const { store } = setup(t);
  const item = (await store.reserve('alice', input)).media;
  await assert.rejects(store.bindSource(item.id, { ...source(item), checksum: 'c'.repeat(64) }), { status: 422 });
  await assert.rejects(store.bindSource(item.id, { ...source(item), key: 'incoming/foreign' }), { status: 422 });
  assert.equal(await store.bindSource(item.id, source(item)), true);
  assert.equal(await store.bindSource(item.id, source(item)), false);
  await assert.rejects(store.bindSource(item.id, source(item, 'replacement-version')), { status: 409 });
});

test('only one processing claim wins; expired leases fence stale success/failure and commit one outbox event', async t => {
  const { store, db, namespace, advance } = setup(t);
  const item = (await store.reserve('alice', input)).media;
  await store.bindSource(item.id, source(item));
  const claims = await Promise.all(Array.from({ length: 3 }, () => store.claim(item.id, modelSha256, 1000)));
  const old = claims.find(Boolean)!;
  assert.equal(claims.filter(Boolean).length, 1);
  await assert.rejects(store.retry(item.id, 'alice'), { status: 409 });
  advance(1001);
  const next = (await store.claim(item.id, modelSha256, 1000))!;
  assert.notEqual(next.token, old.token);
  assert.equal(await store.complete(old, detection, thumbnail(old)), false);
  assert.equal(await store.fail(old, 'PROCESSING_FAILED'), false);
  await assert.rejects(store.complete(next, detection), /thumbnail/);
  assert.equal(await store.complete(next, detection, thumbnail(next)), true);
  assert.equal(await store.complete(next, detection, thumbnail(next)), false);
  const complete = await store.get(item.id, 'alice');
  assert.equal(complete.phase, 'complete');
  assert.equal(complete.thumbnailWidth, 320);
  assert.deepEqual(complete.species, { cat: 2 });
  const events = await db.collection(`${namespace}_outbox`).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0]!.get('kind'), 'upload');
});

test('processing retries preserve manual tags, increment generation and reject changed model digests', async t => {
  const { store } = setup(t);
  const item = (await store.reserve('alice', input)).media;
  await store.bindSource(item.id, source(item));
  const first = (await store.claim(item.id, modelSha256))!;
  await store.fail(first, 'PROCESSOR_UNAVAILABLE');
  await store.editTags([item.id], ['ginger'], 1, 'alice');
  await assert.rejects(store.retry(item.id, 'bob'), { status: 404 });
  const ready = await store.retry(item.id, 'alice');
  assert.equal(ready.generation, 2);
  assert.deepEqual(ready.manualTags, ['ginger']);
  const second = (await store.claim(item.id, modelSha256))!;
  await assert.rejects(store.complete(second, { ...detection, model: { ...detection.model, weightsSha256: 'c'.repeat(64) } }, thumbnail(second)), /digest/);
  assert.equal(await store.complete(second, detection, thumbnail(second)), true);
  assert.deepEqual((await store.get(item.id, 'alice')).manualTags, ['ginger']);
});

test('mixed-owner tag/delete batches make no changes; public visibility never grants mutation', async t => {
  const { store } = setup(t);
  const alice = (await store.reserve('alice', input)).media;
  const bob = (await store.reserve('bob', { ...input, visibility: 'public' })).media;
  await assert.rejects(store.get(bob.id, 'alice'), { status: 404 });
  await store.bindSource(bob.id, source(bob));
  assert.equal((await store.get(bob.id, 'alice')).ownerId, 'bob');
  await assert.rejects(store.editTags([alice.id, bob.id], ['collar'], 1, 'alice'), { status: 404 });
  await assert.rejects(store.beginDelete([alice.id, bob.id], 'alice'), { status: 404 });
  assert.deepEqual((await store.get(alice.id, 'alice')).manualTags, []);
  assert.equal((await store.get(alice.id, 'alice')).phase, 'awaiting-upload');
});

test('deletion tombstones block late workers and checksum reuse until idempotent cleanup finishes', async t => {
  const { store } = setup(t);
  const item = (await store.reserve('alice', input)).media;
  await store.bindSource(item.id, source(item));
  const ticket = (await store.claim(item.id, modelSha256))!;
  await assert.rejects(store.finishDelete(item.id), { status: 409 });
  await store.beginDelete([item.id], 'alice');
  assert.equal(await store.complete(ticket, detection, thumbnail(ticket)), false);
  assert.equal(await store.bindSource(item.id, source(item)), false);
  await assert.rejects(store.get(item.id, 'alice'), { status: 404 });
  await assert.rejects(store.reserve('alice', input), { status: 409 });
  assert.equal((await store.beginDelete([item.id], 'alice'))[0]!.phase, 'deleting');
  assert.equal(await store.finishDelete(item.id), true);
  assert.equal(await store.finishDelete(item.id), false);
  assert.notEqual((await store.reserve('alice', input)).media.id, item.id);
});

test('search crosses multiple Firestore pages, applies full AND counts, deduplicates owned public results and respects lost-pet dates', async t => {
  const { db, store, namespace } = setup(t);
  const base = (await store.reserve('alice', input)).media;
  const batch = db.batch();
  for (let i = 0; i < 105; i++) {
    const id = randomUUID();
    batch.set(db.collection(`${namespace}_media`).doc(id), {
      ...base, id, ownerId: i === 104 ? 'bob' : 'alice', visibility: 'public',
      phase: i === 103 ? 'deleting' : 'complete', processingStatus: 'complete',
      createdAt: i === 102 ? '2020-01-01T00:00:00.000Z' : '2026-11-08T00:00:00.000Z',
      species: { cat: 2, dog: i === 101 ? 1 : 3 }, manualTags: ['ginger'],
    });
  }
  // A private record from another owner must never become a candidate.
  const privateId = randomUUID();
  batch.set(db.collection(`${namespace}_media`).doc(privateId), { ...base, id: privateId, ownerId: 'bob', phase: 'complete', species: { cat: 2, dog: 3 }, manualTags: ['ginger'] });
  await batch.commit();
  const found = await store.search('alice', { cat: 2, dog: 2, ginger: 1 });
  assert.equal(found.length, 103); // Includes the dated record and Bob's public result, each once.
  assert.equal(new Set(found.map(m => m.id)).size, 103);
  assert.equal(found.some(m => m.id === privateId), false);
  const recent = await store.search('alice', { cat: 2, dog: 2 }, { since: '2026-11-01T00:00:00.000Z', until: '2026-11-09T00:00:00.000Z' });
  assert.equal(recent.length, 102);
  assert.equal((await store.search('alice', { cat: 3 })).length, 0);
});
