import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MediaService } from '../src/media/service.js';
import { MemoryRepository } from '../src/database/memory.js';
import { LocalStorage } from '../src/storage/local.js';
import { createApp } from '../src/app.js';
import { serve } from './http-helper.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
test('mock temporary query: AND/minimum counts, no detections, validation/failure and zero permanent writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-query-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new MemoryRepository();
  const seed = new MediaService(repo, new LocalStorage(root));
  const item = (await seed.upload(png, 'image/png', 'cat.png')).media;
  item.species = { cat: 2, dog: 1 }; await repo.save(item);
  let species: Record<string, number> = { cat: 2, dog: 1 };
  let invalid = false, broken = false;
  const service = new MediaService(repo, new LocalStorage(root), undefined, {
    detect: async () => { if (broken) throw Error('mock inference failed'); return { species, model: { identity: 'mock', version: '1', weightsSha256: 'a'.repeat(64), confidence: 0.25 } }; },
  }, { validate: async () => { if (invalid) throw Error('mock decoding failed'); } });
  const before = await readdir(root);
  const records = await repo.list();
  const call = await serve(t, createApp({ media: service, maxUploadBytes: 200 }));
  const query = () => call('/api/search/image', 'POST', png, { 'Content-Type': 'image/png' });
  assert.equal((await query()).json.media[0].id, item.id);
  species = { cat: 3 }; assert.deepEqual((await query()).json.media, []);
  species = { cat: 1, horse: 1 }; assert.deepEqual((await query()).json.media, []);
  species = {}; assert.deepEqual((await query()).json.media, []);
  invalid = true; assert.equal((await query()).status, 500); invalid = false;
  broken = true; assert.equal((await query()).status, 500); broken = false;
  assert.equal((await call('/api/search/image', 'POST', png, { 'Content-Type': 'image/jpeg' })).status, 415);
  assert.equal((await call('/api/search/image', 'POST', Buffer.alloc(201), { 'Content-Type': 'image/png' })).status, 413);
  assert.equal((await call('/api/search/image')).status, 405);
  assert.equal((await call('/api/search/image', 'POST', Buffer.alloc(0), { 'Content-Type': 'image/png' })).status, 415);
  assert.deepEqual(await repo.list(), records);
  assert.deepEqual(await readdir(root), before);
});

test('mock lost-pet image: public only, inclusive date window and AND descriptive manual tags', async t => {
  const repo = new MemoryRepository();
  const storage = { put: async () => {}, get: async () => png, remove: async () => {} };
  const seed = new MediaService(repo, storage);
  const base = (await seed.upload(png, 'image/png', 'cat.png')).media;
  for (const [suffix, visibility, createdAt, manualTags] of [
    ['1', 'public', '2026-10-10T00:00:00.000Z', ['ginger', 'collar']],
    ['2', 'private', '2026-10-10T00:00:00.000Z', ['ginger', 'collar']],
    ['3', 'public', '2026-09-01T00:00:00.000Z', ['ginger', 'collar']],
    ['4', 'public', '2026-10-10T00:00:00.000Z', ['ginger']],
    ['5', 'public', '2026-10-20T00:00:00.000Z', ['ginger', 'collar']],
  ] as const) await repo.save({ ...base, id: suffix.padStart(36, '0'), visibility, createdAt, manualTags: [...manualTags], species: { cat: 2 } });
  let species: Record<string, number> = { cat: 1 };
  const service = new MediaService(repo, storage, undefined, { detect: async () => ({ species, model: { identity: 'mock', version: '1', weightsSha256: 'a'.repeat(64), confidence: 0.25 } }) }, { validate: async () => {} });
  const call = await serve(t, createApp({ media: service }));
  const query = (suffix: string) => call('/api/search/lost-pet/image?' + suffix, 'POST', png, { 'Content-Type': 'image/png' });
  const found = await query('since=2026-10-10T00:00:00Z&until=2026-10-10T00:00:00Z&tag=Ginger&tag=collar');
  assert.equal(found.status, 200);
  assert.deepEqual(found.json.media.map((m: { id: string }) => m.id), ['1'.padStart(36, '0')]);
  for (const suffix of ['since=bad', 'since=2026-02-30T00:00:00Z', 'since=2027-01-01T00:00:00Z&until=2026-01-01T00:00:00Z', 'tag=']) assert.equal((await query(suffix)).status, 400);
  species = {}; assert.deepEqual((await query('tag=ginger')).json.media, []);
  const missing = new MediaService(repo, storage);
  await assert.rejects(missing.searchImage(png, 'image/png'), /Configure/);
});
