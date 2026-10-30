import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteRepository } from '../src/database/sqlite.js';
import { LocalStorage } from '../src/storage/local.js';
import { MediaService } from '../src/media/service.js';
import { createApp } from '../src/app.js';
import { serve } from './http-helper.js';
import { validateDetection, PythonDetector, type Detection } from '../src/processing/detector.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
const model = { identity: 'mock-coco', version: 'test/1', weightsSha256: 'a'.repeat(64), confidence: 0.25 };
const thumbnailer = { create: async () => ({ bytes: Buffer.from('mock-jpeg'), width: 1, height: 1, originalWidth: 1, originalHeight: 1 }) };

test('mock detector: upload/count search, SQLite reopen, failed retry, manual tags and replacement', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-detection-'));
  let repo = new SqliteRepository(join(root, 'db.sqlite'));
  t.after(async () => { repo.close(); await rm(root, { recursive: true, force: true }); });
  let calls = 0;
  let fail = false;
  let species = { cat: 2, dog: 1 } as Record<string, number>;
  const detector = { detect: async () => { calls++; if (fail) throw Error('private path'); return { species, model }; } };
  const storage = new LocalStorage(join(root, 'files'));
  let service = new MediaService(repo, storage, thumbnailer, detector);
  const uploaded = await service.upload(png, 'image/png', 'cats.png', 'public');
  assert.equal(uploaded.media.processingStatus, 'complete');
  assert.deepEqual(uploaded.media.species, { cat: 2, dog: 1 });
  assert.deepEqual(uploaded.media.detectionModel, model);
  assert.equal((await service.upload(png, 'image/png', 'duplicate.png')).duplicate, true);
  assert.equal(calls, 1);
  await service.editTags([uploaded.media.id], ['ginger', 'cat'], 1);
  repo.close();
  repo = new SqliteRepository(join(root, 'db.sqlite'));
  service = new MediaService(repo, storage, thumbnailer, detector);
  const call = await serve(t, createApp({ media: service }));
  const search = async (tags: Record<string, number>) => (await call('/api/search', 'POST', Buffer.from(JSON.stringify({ tags })), { 'Content-Type': 'application/json' })).json.media;
  assert.equal((await search({ cat: 2, dog: 1, ginger: 1 })).length, 1);
  assert.equal((await search({ cat: 3 })).length, 0);
  fail = true;
  const failed = await call(`/api/media/${uploaded.media.id}/process`, 'POST');
  assert.equal(failed.json.media.processingStatus, 'failed');
  assert.ok(!failed.json.media.processingError.includes('private path'));
  assert.deepEqual(failed.json.media.manualTags, ['ginger', 'cat']);
  assert.equal((await search({ cat: 2 })).length, 0);
  fail = false;
  species = { dog: 3 };
  const retried = await service.process(uploaded.media.id);
  assert.equal(retried.processingStatus, 'complete');
  assert.deepEqual(retried.species, { dog: 3 });
  assert.equal(retried.processingError, undefined);
  assert.equal((await search({ dog: 3, cat: 1 })).length, 1);
  species = {};
  assert.deepEqual((await service.process(uploaded.media.id)).species, {});
  assert.equal((await service.list()).length, 1);
  assert.equal((await call(`/api/media/${uploaded.media.id}/process`)).status, 405);
  assert.equal((await call('/api/media/00000000-0000-0000-0000-000000000000/process', 'POST')).status, 404);
});

test('mock detector: completion persistence failure records failed, never complete; retry succeeds', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-detection-write-'));
  const repo = new SqliteRepository(join(root, 'db.sqlite'));
  t.after(async () => { repo.close(); await rm(root, { recursive: true, force: true }); });
  const save = repo.save.bind(repo);
  let broken = true;
  repo.save = async media => { if (broken && media.processingStatus === 'complete') throw Error('DB failure'); await save(media); };
  const service = new MediaService(repo, new LocalStorage(join(root, 'files')), thumbnailer, { detect: async () => ({ species: { cat: 2 }, model }) });
  const result = await service.upload(png, 'image/png', 'cat.png');
  assert.equal(result.media.processingStatus, 'failed');
  assert.deepEqual((await repo.get(result.media.id))!.species, {});
  broken = false;
  assert.equal((await service.process(result.media.id)).processingStatus, 'complete');
});

test('detector rejects invalid counts, unsupported classes, missing executable/weights', async () => {
  for (const species of [{ cat: 0 }, { cat: 1.5 }, { fox: 1 }]) {
    assert.throws(() => validateDetection({ species, model } as Detection));
  }
  await assert.rejects(new PythonDetector('nonexistent-ecoguard-python', 'missing.pt').detect(png), /Configure ECOGUARD/);
});
