import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { S3Event } from 'aws-lambda';
import { FirestoreMediaStore, type CloudMedia } from '../../src/cloud/firestore-media.js';
import { createProcessor, type ValidatedImage } from '../../src/cloud/processor.js';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Requires the loopback Firestore emulator.');
test('mock validation orchestration: thumbnail publication, honest missing-model failure, invalid rejection and deletion fencing', async t => {
  const db = new Firestore({ projectId: 'demo-ecoguard-g80' });
  const namespace = `worker_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => { for (const name of ['media', 'checksums', 'outbox', 'tombstones', 'control']) await db.recursiveDelete(db.collection(`${namespace}_${name}`)); await db.terminate(); });
  const store = new FirestoreMediaStore(db, namespace);
  const cleanup: string[] = [];
  const orphanVersions: string[] = [];
  let validates = 0;
  let invalid = false;
  let deleteDuringValidation = false;
  const worker = createProcessor({ store, storage: { bucket: 'test-bucket',
    head: async item => ({ version: 'fixture-v1', size: item.size, checksum: item.checksum, contentType: item.contentType }),
    cleanup: async item => { cleanup.push(item.id); },
    removeVersion: async (key, version) => { orphanVersions.push(key + ':' + version); },
  }, async validate(item): Promise<ValidatedImage> {
    validates++;
    if (invalid) return { valid: false, error: 'INVALID_MEDIA' };
    if (deleteDuringValidation) { await store.beginDelete([item.id], item.ownerId); await store.finishDelete(item.id); }
    return { valid: true, checksum: item.checksum, size: item.size, contentType: item.contentType,
      thumbnail: { key: `thumbnails/${item.id}/fixture-version/preview.jpg`, width: 320, height: 200, originalWidth: 960, originalHeight: 600 } };
  } });
  const reserve = async (owner: string, contentType: 'image/png' | 'video/mp4' = 'image/png') => (await store.reserve(owner, { filename: 'fixture.png', size: 100, checksum: 'a'.repeat(64), contentType, visibility: 'public' })).media;
  const image = await reserve('alice');
  await assert.rejects(store.get(image.id, 'bob'), { status: 404 });
  await worker({ mediaId: image.id });
  const processed = await store.get(image.id, 'alice');
  assert.equal(processed.phase, 'failed');
  assert.equal(processed.processingError, 'PROCESSOR_UNAVAILABLE');
  assert.equal(processed.sourceVersion, 'fixture-v1');
  assert.equal(processed.thumbnailWidth, 320);
  assert.deepEqual(processed.species, {}); // Fixture thumbnail is not a detection.
  assert.equal((await store.get(image.id, 'bob')).id, image.id);
  await worker({ mediaId: image.id });
  assert.equal(validates, 1); // Failed jobs need explicit retry; duplicate events do not keep consuming validation work.
  await store.retry(image.id, 'alice');
  await worker({ mediaId: image.id });
  assert.equal(validates, 2);

  const rejected = await reserve('invalid-owner');
  invalid = true;
  await worker({ mediaId: rejected.id });
  assert.equal((await store.get(rejected.id, 'invalid-owner')).phase, 'rejected');
  await assert.rejects(store.get(rejected.id, 'alice'), { status: 404 });
  await assert.rejects(store.retry(rejected.id, 'invalid-owner'), { status: 409 });
  invalid = false;

  const deleted = await reserve('delete-owner');
  deleteDuringValidation = true;
  await worker({ mediaId: deleted.id });
  assert.equal((await store.readForWorker(deleted.id))!.phase, 'deleted');
  assert.deepEqual(cleanup, [deleted.id]);
  await worker({ mediaId: deleted.id });
  assert.deepEqual(cleanup, [deleted.id, deleted.id]);
  deleteDuringValidation = false;

  const video = await reserve('video-owner', 'video/mp4');
  const before = validates;
  await worker({ mediaId: video.id });
  assert.equal(validates, before);
  assert.equal((await store.get(video.id, 'video-owner')).processingError, 'PROCESSOR_UNAVAILABLE');
  assert.equal((await store.retry(video.id, 'video-owner')).phase, 'awaiting-upload');

  const foreignEvent = { Records: [{ eventSource: 'aws:s3', eventName: 'ObjectCreated:Put', s3: { bucket: { name: 'foreign-bucket' }, object: { key: video.storageKey, versionId: 'foreign-v1' } } }] } as unknown as S3Event;
  assert.equal((await worker(foreignEvent)).accepted, 0);
  const orphanId = randomUUID();
  const orphan = { Records: [{ eventSource: 'aws:s3', eventName: 'ObjectCreated:Put', s3: { bucket: { name: 'test-bucket' }, object: { key: `thumbnails/${orphanId}/fixture/preview.jpg`, versionId: 'late-version' } } }] } as unknown as S3Event;
  await worker(orphan);
  assert.deepEqual(orphanVersions, [`thumbnails/${orphanId}/fixture/preview.jpg:late-version`]);
});
