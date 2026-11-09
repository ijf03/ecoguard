import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { S3Client, GetObjectCommand, ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { SSMClient } from '@aws-sdk/client-ssm';
import { CloudImageQueries } from '../dist/cloud/image-query.js';

if (process.env.ECOGUARD_ALLOW_LIVE_TESTS !== '1') throw new Error('Enable controlled live tests explicitly.');
const manifest = JSON.parse(await readFile(new URL('../.build/inference-manifest.json', import.meta.url), 'utf8'));
const s3 = new S3Client({ region: 'us-east-1' });
const lambda = new LambdaClient({ region: 'us-east-1' });
const ssm = new SSMClient({ region: 'us-east-1' });
const bucket = 'ecoguard-g80-media-851725503164-us-east-1';
const queries = new CloudImageQueries(s3, lambda, ssm, bucket, 'ecoguard-g80-processor', 'ecoguard-g80-inference');
const fixture = manifest.linuxPreflightFixtures.image.event;
const owner = 'synthetic-query-' + randomUUID();
let prefix;
try {
  const source = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fixture.key, VersionId: fixture.version }));
  const bytes = await source.Body.transformToByteArray();
  const query = await queries.reserve(owner, { purpose: 'lost-pet', options: { tags: ['collar'] }, file: { checksum: fixture.checksum, size: bytes.length, contentType: fixture.contentType } });
  prefix = new URL(query.upload.url).pathname.slice(1).replace(/input$/, '');
  assert.equal((await fetch(query.upload.url, { method: 'PUT', headers: query.upload.headers, body: bytes })).status, 200);
  await assert.rejects(queries.poll('another-user', query.token), { status: 404 });
  await queries.start(owner, query.token);
  const deadline = Date.now() + 180000;
  let result;
  do {
    result = await queries.poll(owner, query.token);
    if ('detection' in result) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  } while (Date.now() < deadline);
  assert.ok('detection' in result, 'The deployed query worker did not finish.');
  assert.deepEqual(result.detection.species, { dog: 1 });
  assert.equal(result.detection.model.weightsSha256, manifest.modelSha256);
  assert.deepEqual(result.window.tags, ['collar']);
  const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix + 'input' }));
  assert.equal((versions.Versions ?? []).length, 0);
  assert.equal((versions.DeleteMarkers ?? []).length, 0);
  console.log('LIVE QUERY PASS: signed temporary upload -> actual asynchronous Lambda inference -> owner-bound polling, lost-pet filters, and immediate removal of all query-input versions. No media record/index was created.');
} finally {
  if (prefix) {
    const objects = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }));
    const Objects = [...(objects.Versions ?? []), ...(objects.DeleteMarkers ?? [])].map(item => ({ Key: item.Key, VersionId: item.VersionId }));
    if (Objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects } }));
  }
  s3.destroy(); lambda.destroy(); ssm.destroy();
}
