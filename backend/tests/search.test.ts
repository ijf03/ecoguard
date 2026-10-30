import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/database/memory.js';
import { MediaService } from '../src/media/service.js';
import { createApp } from '../src/app.js';
import type { Media } from '../src/media/contracts.js';
import { serve } from './http-helper.js';

test('HTTP count search uses AND and minimum counts; lost pets use recent public sightings', async t => {
  const repo = new MemoryRepository();
  const base: Media = { id: '00000000-0000-0000-0000-000000000001', filename: 'sample.png',
    checksum: 'a'.repeat(64), storageKey: '00000000-0000-0000-0000-000000000001', contentType: 'image/png',
    size: 100, createdAt: new Date().toISOString(), visibility: 'public', processingStatus: 'complete',
    species: { fox: 2, cat: 1 }, manualTags: ['ginger'] };
  // Seeded records test query semantics; these are not claims of executed ML inference.
  await repo.save(base);
  await repo.save({ ...base, id: '00000000-0000-0000-0000-000000000002', species: { fox: 1, cat: 1 }, visibility: 'private' });
  await repo.save({ ...base, id: '00000000-0000-0000-0000-000000000003', species: { cat: 1 }, createdAt: '2020-01-01T00:00:00.000Z' });
  const service = new MediaService(repo, { put: async () => {}, get: async () => Buffer.alloc(0), remove: async () => {} });
  const call = await serve(t, createApp({ media: service }));
  const query = (path: string, body: unknown) => call(path, 'POST', Buffer.from(JSON.stringify(body)), { 'Content-Type': 'application/json' });
  const found = await query('/api/search', { tags: { ' FOX ': 2, cat: 1, ginger: 1 } });
  assert.equal(found.status, 200);
  assert.deepEqual(found.json.media.map((m: Media) => m.id), [base.id]);
  assert.deepEqual((await query('/api/search', { tags: { fox: 3 } })).json.media, []);
  assert.equal((await query('/api/search', { tags: { cat: 1 } })).json.media.length, 3);
  const lost = await query('/api/search/lost-pet', { species: 'Cat', tags: ['Ginger'] });
  assert.equal(lost.status, 200);
  assert.deepEqual(lost.json.media.map((m: Media) => m.id), [base.id]);
  for (const body of [{}, { tags: {} }, { tags: { fox: 0 } }, { tags: { fox: -1 } },
    { tags: { fox: 1.2 } }, { tags: { fox: '2' } }, { tags: [] }, { tags: { '': 1 } }]) {
    assert.equal((await query('/api/search', body)).status, 400);
  }
  for (const body of [{}, { species: 'cat', tags: 'ginger' }, { species: 'cat', since: 'yesterday' }]) {
    assert.equal((await query('/api/search/lost-pet', body)).status, 400);
  }
  assert.equal((await call('/api/search', 'POST', Buffer.from('{'), { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await call('/api/search', 'POST', Buffer.from('{}'))).status, 415);
});
