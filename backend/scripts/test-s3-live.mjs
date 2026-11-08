import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { S3MediaStorage } from '../dist/cloud/s3-media.js';
const bucket = process.env.ECOGUARD_LIVE_S3_BUCKET;
if (process.env.ECOGUARD_ALLOW_LIVE_TESTS !== '1' || bucket !== 'ecoguard-g80-media-851725503164-us-east-1') throw new Error('Explicitly enable live tests and select the dedicated EcoGuard media bucket.');
const client = new S3Client({ region: 'us-east-1' });
const storage = new S3MediaStorage(client, bucket);
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
const id = randomUUID();
const item = { id, ownerId: 'synthetic-storage-verification', filename: 'fixture.png', checksum: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
  storageKey: `verification/${id}/source.png`, contentType: 'image/png', createdAt: new Date().toISOString(), visibility: 'private',
  processingStatus: 'pending', species: {}, manualTags: [], phase: 'awaiting-upload', revision: 1, generation: 1, uploadExpiresAt: Date.now() + 900000 };
try {
  const upload = await storage.upload(item);
  assert.equal((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes })).status, 200);
  assert.equal((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes })).status, 412);
  const head = await storage.head(item);
  assert.ok(head.version);
  assert.equal(head.size, bytes.length);
  assert.equal(head.checksum, Buffer.from(item.checksum, 'hex').toString('base64'));
  item.sourceVersion = head.version;
  const download = await storage.download(item);
  assert.deepEqual(Buffer.from(await (await fetch(download)).arrayBuffer()), bytes);
  const range = await fetch(download, { headers: { Range: 'bytes=1-3' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(1, 4));
  console.log('LIVE S3 PASS: signed checksum/length/type upload, conditional overwrite rejection, versioned retrieval and byte ranges. No credentials or signed URLs are logged.');
} finally {
  await storage.cleanup(item);
  client.destroy();
  console.log('Removed all versions of this smoke run\'s synthetic source key.');
}
