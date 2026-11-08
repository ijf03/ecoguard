import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMediaApi } from '../../frontend/src/api/media.js';

test('cloud client hashes bytes, uploads directly without Cognito credentials, handles conditional duplicates and confirms separately', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const bytes = Buffer.from('synthetic browser upload fixture');
  const file = new File([bytes], 'fixture.png', { type: 'image/png' });
  let puts = 0;
  let completes = 0;
  let duplicate = false;
  let storageUrl = 'https://test-bucket.s3.us-east-1.amazonaws.com/immutable-key?X-Amz-Signature=fixture';
  let storageStatus = 200;
  globalThis.fetch = async (url, options) => {
    puts++;
    assert.equal(new URL(String(url)).hostname, 'test-bucket.s3.us-east-1.amazonaws.com');
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.body, file);
    return new Response(null, { status: storageStatus });
  };
  const api = createMediaApi(async (path, options) => {
    if (path === '/api/uploads') {
      assert.deepEqual(JSON.parse(String(options?.body)), { filename: file.name, size: file.size, contentType: file.type, visibility: 'private', checksum: createHash('sha256').update(bytes).digest('hex') });
      return Response.json({ media: { id: 'fixture-id' }, duplicate, ...(!duplicate ? { upload: { url: storageUrl, headers: { 'Content-Type': file.type, 'If-None-Match': '*' } } } : {}) });
    }
    assert.equal(path, '/api/uploads/fixture-id/complete');
    completes++;
    return Response.json({ media: { id: 'fixture-id', processingStatus: 'pending' } }, { status: 202 });
  }, () => true);
  assert.equal((await api.upload(file)).duplicate, false);
  assert.equal(puts, 1); assert.equal(completes, 1);
  storageStatus = 412;
  await api.upload(file);
  assert.equal(completes, 2);
  duplicate = true;
  assert.equal((await api.upload(file)).duplicate, true);
  assert.equal(puts, 2);
  duplicate = false;
  storageUrl = 'https://attacker.test/collect';
  await assert.rejects(api.upload(file), /Unexpected upload storage/);
  assert.equal(puts, 2);
});
