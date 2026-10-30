import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalServices } from '../src/local.js';
import { createApp } from '../src/app.js';
import { serve } from './http-helper.js';

test('bulk tags persist, add idempotently, remove missing/inferred tags, reject partial batches', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-tags-'));
  const first = await createLocalServices(root);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
  const a = (await first.media.upload(png, 'image/png', 'cat.png')).media;
  const b = (await first.media.upload(Buffer.concat([png, Buffer.from('different')]), 'image/png', 'cat2.png')).media;
  const { SqliteRepository } = await import('../src/database/sqlite.js');
  const seeded = new SqliteRepository(join(root, 'metadata.sqlite'));
  await seeded.save({ ...a, species: { fox: 2 } });
  seeded.close();
  const call = await serve(t, createApp(first));
  const urls = [a, b].map(m => `/api/media/${m.id}/file`);
  const post = (body: unknown) => call('/api/media/tags', 'POST', Buffer.from(JSON.stringify(body)), { 'Content-Type': 'application/json' });
  assert.equal((await post({ urls, tags: [' CAT ', 'ginger', 'cat'], operation: 1 })).status, 200);
  assert.equal((await post({ urls, tags: ['cat'], operation: 1 })).status, 200);
  assert.deepEqual((await first.media.get(a.id)).manualTags, ['cat', 'ginger']);
  assert.equal((await first.media.search({ cat: 1, ginger: 1 })).length, 2);
  const missingUrl = '/api/media/00000000-0000-0000-0000-000000000000/file';
  assert.equal((await post({ urls: [urls[0], missingUrl], tags: ['should-not-save'], operation: 1 })).status, 404);
  assert.ok(!(await first.media.get(a.id)).manualTags.includes('should-not-save'));
  assert.equal((await post({ urls, tags: ['absent', 'ginger', 'fox'], operation: 0 })).status, 200);
  for (const body of [
    { urls: [], tags: ['cat'], operation: 1 }, { urls, tags: [], operation: 1 },
    { urls, tags: ['cat'], operation: '1' }, { urls: ['https://example.com/private'], tags: ['cat'], operation: 1 },
  ]) assert.equal((await post(body)).status, 400);
  assert.deepEqual((await first.media.get(a.id)).species, {});
  assert.deepEqual(await first.media.search({ fox: 1 }), []);
  first.close();
  const second = await createLocalServices(root);
  assert.deepEqual((await second.media.get(a.id)).manualTags, ['cat']);
  second.close();
  t.after(() => rm(root, { recursive: true, force: true }));
});
