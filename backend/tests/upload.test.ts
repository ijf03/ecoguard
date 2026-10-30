import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { MemoryRepository } from '../src/database/memory.js';
import { LocalStorage } from '../src/storage/local.js';
import { MediaService } from '../src/media/service.js';
import { serve } from './http-helper.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
async function setup(t: Parameters<typeof serve>[0]) {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new MemoryRepository();
  const call = await serve(t, createApp({ media: new MediaService(repo, new LocalStorage(root)), maxUploadBytes: 1024 }));
  return { root, repo, call };
}
test('upload, byte retrieval and concurrent content deduplication', async t => {
  const { root, repo, call } = await setup(t);
  const headers = { 'Content-Type': 'image/png', 'X-Filename': 'cat.png' };
  const results = await Promise.all([call('/api/media', 'POST', png, headers), call('/api/media', 'POST', png, { ...headers, 'X-Filename': 'other.png' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal(results[0]!.json.media.id, results[1]!.json.media.id);
  assert.equal(results[0]!.json.media.checksum.length, 64);
  assert.equal((await repo.list()).length, 1);
  assert.equal((await readdir(root)).length, 1);
  const result = await call(results[0]!.json.media.originalUrl);
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-type'], 'image/png');
  assert.deepEqual(result.bytes, png);
});
test('invalid upload bodies, MIME mismatch, size, filename, visibility, missing resource', async t => {
  const { call, repo } = await setup(t);
  const headers = { 'Content-Type': 'image/png' };
  for (const [body, extra, expected] of [
    [Buffer.alloc(0), {}, 415], [Buffer.from('not an image'), {}, 415],
    [png, { 'Content-Type': 'image/jpeg' }, 415], [Buffer.alloc(1025), {}, 413],
    [png, { 'X-Filename': '..%2Fsecret' }, 400], [png, { 'X-Filename': '%' }, 400],
    [png, { 'X-Visibility': 'invalid' }, 400],
  ] as const) {
    const result = await call('/api/media', 'POST', body, { ...headers, ...extra });
    assert.equal(result.status, expected);
    assert.equal(typeof result.json.error.code, 'string');
  }
  assert.equal((await repo.list()).length, 0);
  assert.equal((await call('/api/media/00000000-0000-0000-0000-000000000000/file')).status, 404);
});
test('storage failure is a sanitized JSON error', async t => {
  const media = new MediaService(new MemoryRepository(), {
    put: async () => { throw new Error('sensitive local path'); },
    get: async () => Buffer.alloc(0), remove: async () => {},
  });
  const call = await serve(t, createApp({ media }));
  const result = await call('/api/media', 'POST', png, { 'Content-Type': 'image/png' });
  assert.equal(result.status, 500);
  assert.equal(result.json.error.code, 'INTERNAL_ERROR');
  assert.ok(!result.bytes.toString().includes('sensitive'));
});
