import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createLocalServices } from '../src/local.js';
import { createApp } from '../src/app.js';
import { serve } from './http-helper.js';
import { MemoryRepository } from '../src/database/memory.js';
import { MediaService } from '../src/media/service.js';
import { LocalStorage } from '../src/storage/local.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
test('bulk deletion removes metadata, originals and thumbnails and allows fresh upload', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-ecoguard-delete-'));
  const services = await createLocalServices(root);
  const call = await serve(t, createApp(services));
  t.after(async () => { services.close(); await rm(root, { recursive: true, force: true }); });
  const a = (await services.media.upload(png, 'image/png', 'a.png')).media;
  // Deterministic injected thumbnail isolates lifecycle coordination from image decoding tests.
  const repo = new MemoryRepository();
  const storage = new LocalStorage(join(root, 'with-thumbnails'));
  const service = new MediaService(repo, storage, { create: async () => ({ bytes: png, width: 1, height: 1, originalWidth: 1, originalHeight: 1 }) });
  const item = (await service.upload(png, 'image/png', 'b.png')).media;
  await service.deleteMany([item.id]);
  assert.equal((await readdir(join(root, 'with-thumbnails'))).filter(name => name !== '.trash').length, 0);
  assert.equal((await repo.list()).length, 0);
  const url = `/api/media/${a.id}/file`;
  const post = (urls: string[]) => call('/api/media/delete', 'POST', Buffer.from(JSON.stringify({ urls })), { 'Content-Type': 'application/json' });
  assert.equal((await post([url, '/api/media/00000000-0000-0000-0000-000000000000/file'])).status, 404);
  assert.equal((await services.media.list()).length, 1);
  const deleted = await post([url, url]);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, { deleted: 1, cleanupPending: false });
  assert.equal((await call(url)).status, 404);
  assert.deepEqual((await call('/api/media')).json.media, []);
  assert.equal((await post([])).status, 400);
  const fresh = await services.media.upload(png, 'image/png', 'new.png');
  assert.equal(fresh.duplicate, false);
  assert.notEqual(fresh.media.id, a.id);
});
test('failed DB deletion restores staged bytes and keeps metadata', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-ecoguard-rollback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new MemoryRepository();
  const storage = new LocalStorage(root);
  const service = new MediaService(repo, storage);
  const media = (await service.upload(png, 'image/png', 'cat.png')).media;
  repo.removeMany = async () => { throw new Error('database unavailable'); };
  await assert.rejects(service.deleteMany([media.id]), /database unavailable/);
  assert.deepEqual((await service.file(media.id)).bytes, png);
  assert.equal((await repo.list()).length, 1);
});
test('startup recovers deletion interrupted before or after database commit', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-ecoguard-recover-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await createLocalServices(root);
  const media = (await first.media.upload(png, 'image/png', 'cat.png')).media;
  await new LocalStorage(join(root, 'originals')).stageDelete([media.storageKey]);
  first.close(); // Simulated crash before DB commit: restore original on startup.
  const second = await createLocalServices(root);
  assert.deepEqual((await second.media.file(media.id)).bytes, png);
  second.close();
  const storage = new LocalStorage(join(root, 'originals'));
  await storage.stageDelete([media.storageKey]);
  // Simulate committed DB removal with an adapter connected to the same database.
  const { SqliteRepository } = await import('../src/database/sqlite.js');
  const repo = new SqliteRepository(join(root, 'metadata.sqlite'));
  await repo.removeMany([media.id]);
  repo.close();
  const third = await createLocalServices(root);
  assert.deepEqual(await third.media.list(), []);
  assert.deepEqual(await readdir(join(root, 'originals', '.trash')), []);
  third.close();
});
