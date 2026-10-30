import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { PythonThumbnailer } from '../src/processing/thumbnail.js';
import { createApp } from '../src/app.js';
import { MediaService } from '../src/media/service.js';
import { MemoryRepository } from '../src/database/memory.js';
import { LocalStorage } from '../src/storage/local.js';
import { serve } from './http-helper.js';

test('real Pillow thumbnail preserves aspect, compresses, retrieves and resolves original', { skip: !process.env.TEST_PYTHON }, async t => {
  const python = process.env.TEST_PYTHON!;
  const png = execFileSync(python, ['-c',
    'from PIL import Image; import sys; im=Image.effect_noise((960,480),80).convert("RGB"); im.save(sys.stdout.buffer,format="PNG")'], { maxBuffer: 4 * 1024 * 1024 });
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-thumb-'));
  const repo = new MemoryRepository();
  const service = new MediaService(repo, new LocalStorage(root), new PythonThumbnailer(python));
  const call = await serve(t, createApp({ media: service }));
  t.after(() => rm(root, { recursive: true, force: true }));
  const upload = await call('/api/media', 'POST', png, { 'Content-Type': 'image/png' });
  assert.equal(upload.status, 201);
  const media = upload.json.media;
  assert.equal(media.width, 960);
  assert.equal(media.height, 480);
  assert.equal(media.thumbnailWidth, 320);
  assert.equal(media.thumbnailHeight, 160);
  assert.equal(media.processingStatus, 'pending'); // No fabricated inference.
  const thumbnail = await call(media.thumbnailUrl);
  assert.equal(thumbnail.status, 200);
  assert.equal(thumbnail.headers['content-type'], 'image/jpeg');
  assert.ok(thumbnail.bytes.length < png.length);
  const dimensions = execFileSync(python, ['-c', 'from PIL import Image; import io,sys; print(Image.open(io.BytesIO(sys.stdin.buffer.read())).size)'], { input: thumbnail.bytes }).toString();
  assert.equal(dimensions.trim(), '(320, 160)');
  const resolved = await call('/api/search/thumbnail', 'POST', Buffer.from(JSON.stringify({ thumbnailUrl: media.thumbnailUrl })), { 'Content-Type': 'application/json' });
  assert.equal(resolved.json.media.originalUrl, media.originalUrl);
  assert.equal((await call('/api/search/thumbnail', 'POST', Buffer.from('{}'), { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await call('/api/media/00000000-0000-0000-0000-000000000000/thumbnail')).status, 404);
  const corrupt = await call('/api/media', 'POST', png.subarray(0, 28), { 'Content-Type': 'image/png' });
  assert.equal(corrupt.status, 422);
  assert.equal((await repo.list()).length, 1);
  assert.equal((await readdir(root)).length, 2);
});
