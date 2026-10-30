import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalServices } from '../src/local.js';
import { createApp } from '../src/app.js';
import { serve } from './http-helper.js';
import { createMediaApi, ApiError } from '../../frontend/src/api/media.js';

test('frontend typed client completes upload/list/tag/search/lost-pet/delete over real HTTP', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-ecoguard-client-'));
  const services = await createLocalServices(root);
  const call = await serve(t, createApp(services));
  t.after(async () => { services.close(); await rm(root, { recursive: true, force: true }); });
  const api = createMediaApi(async (path, options = {}) => {
    const body = options.body instanceof Blob ? Buffer.from(await options.body.arrayBuffer())
      : typeof options.body === 'string' ? Buffer.from(options.body) : undefined;
    const result = await call(path, options.method ?? 'GET', body, Object.fromEntries(new Headers(options.headers).entries()));
    return new Response(new Uint8Array(result.bytes), { status: result.status,
      headers: { 'Content-Type': String(result.headers['content-type']) } });
  });
  assert.deepEqual((await api.list()).media, []);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
  const file = new File([png], 'cat photo.png', { type: 'image/png' });
  const upload = await api.upload(file, 'public');
  assert.equal(upload.duplicate, false);
  assert.equal(upload.media.filename, 'cat photo.png');
  assert.equal((await api.upload(file)).duplicate, true);
  assert.equal((await api.get(upload.media.id)).media.id, upload.media.id);
  await api.editTags([upload.media.originalUrl], ['cat', 'ginger'], 1);
  assert.equal((await api.search({ cat: 1, ginger: 1 })).media.length, 1);
  assert.equal((await api.lostPet('cat', ['ginger'])).media.length, 1);
  await api.editTags([upload.media.originalUrl], ['ginger'], 0);
  assert.equal((await api.search({ ginger: 1 })).media.length, 0);
  await assert.rejects(api.search({ cat: 0 }), error => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY');
  assert.equal((await api.delete([upload.media.originalUrl])).deleted, 1);
  assert.deepEqual((await api.list()).media, []);
});
