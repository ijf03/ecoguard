import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { S3MediaStorage } from '../src/cloud/s3-media.js';
import type { CloudMedia } from '../src/cloud/firestore-media.js';

test('real S3 presigner binds checksum, type, length and overwrite precondition without network calls', async () => {
  const client = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'ecoguard-test-access', secretAccessKey: 'test-only-not-a-real-secret' } });
  try {
    const storage = new S3MediaStorage(client, 'ecoguard-test-bucket');
    const item: CloudMedia = { id: '00000000-0000-4000-8000-000000000000', ownerId: 'alice', filename: 'cat.png', checksum: 'a'.repeat(64), size: 100,
      storageKey: 'incoming/owner-hash/immutable-id', contentType: 'image/png', createdAt: new Date().toISOString(), visibility: 'private',
      processingStatus: 'pending', species: {}, manualTags: [], phase: 'awaiting-upload', revision: 1, generation: 1, uploadExpiresAt: Date.now() + 900000 };
    const signed = await storage.upload(item);
    const url = new URL(signed.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'ecoguard-test-bucket.s3.us-east-1.amazonaws.com');
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
    for (const header of ['content-length', 'content-type', 'if-none-match', 'x-amz-checksum-sha256']) assert.ok(signedHeaders.includes(header), header);
    assert.equal(signed.headers['If-None-Match'], '*');
    assert.equal(signed.headers['x-amz-checksum-sha256'], Buffer.from(item.checksum, 'hex').toString('base64'));
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(await storage.download(item), undefined);
    item.sourceVersion = 'immutable-version';
    const original = new URL((await storage.download(item))!);
    assert.equal(original.searchParams.get('versionId'), 'immutable-version');
    assert.equal(original.searchParams.get('response-content-type'), 'image/png');
    assert.equal(original.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(await storage.download(item, true), undefined);
  } finally { client.destroy(); }
});
