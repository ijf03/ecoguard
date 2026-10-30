import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { createLocalServices } from '../src/local.js';
import { serve } from './http-helper.js';
import { MediaService } from '../src/media/service.js';
import { MemoryRepository } from '../src/database/memory.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');

test('SQLite close/reopen preserves listing, detail, bytes and checksum uniqueness', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-db-'));

  const first = await createLocalServices(root);
  const upload = await first.media.upload(png, 'image/png', 'cat.png', 'public');
  first.close();
  const second = await createLocalServices(root);

  const call = await serve(t, createApp(second));
  t.after(async () => { second.close(); await rm(root, { recursive: true, force: true }); });
  const list = await call('/api/media');
  assert.equal(list.status, 200);
  assert.equal(list.json.media.length, 1);
  const detail = await call(`/api/media/${upload.media.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.media.filename, 'cat.png');
  assert.equal(detail.json.media.visibility, 'public');
  assert.equal(detail.json.media.processingStatus, 'failed'); // Local composition has no configured model in tests.
  assert.equal(detail.json.media.checksum, upload.media.checksum);
  assert.equal(detail.json.media.createdAt, upload.media.createdAt);
  const original = await call(detail.json.media.originalUrl);
  assert.deepEqual(original.bytes, png);
  const duplicate = await call('/api/media', 'POST', png, { 'Content-Type': 'image/png' });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.json.duplicate, true);
  assert.equal(duplicate.json.media.id, upload.media.id);
  assert.equal((await call('/api/media/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await call('/api/media', 'DELETE')).status, 405);
});

test('empty database returns empty list', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-empty-'));

  const services = await createLocalServices(root);

  const call = await serve(t, createApp(services));
  t.after(async () => { services.close(); await rm(root, { recursive: true, force: true }); });
  assert.deepEqual((await call('/api/media')).json.media, []);
});

test('metadata write failure rolls back stored original', async () => {
  let removed: string | undefined;
  const repo = new MemoryRepository();
  repo.save = async () => { throw new Error('database unavailable'); };
  const service = new MediaService(repo, {
    put: async () => {}, get: async () => Buffer.alloc(0),
    remove: async key => { removed = key; },
  });
  await assert.rejects(service.upload(png, 'image/png', 'cat.png'), /database unavailable/);
  assert.ok(removed);
  assert.equal((await repo.list()).length, 0);
});
