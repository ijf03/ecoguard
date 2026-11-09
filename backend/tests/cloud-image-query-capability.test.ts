import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudImageQueries } from '../src/cloud/image-query.js';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { SSMClient } from '@aws-sdk/client-ssm';

test('temporary image capabilities bind owner/bytes, reject tampering, deduplicate workers and clean input versions without media indexing', async () => {
  const s3 = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' } });
  const lambda = new LambdaClient({ region: 'us-east-1' });
  const ssm = new SSMClient({ region: 'us-east-1' });
  const objects = new Map<string, string>();
  const sha = 'a'.repeat(64);
  const detection = { species: { dog: 3 }, model: { identity: 'fixture', version: '1', confidence: 0.25, weightsSha256: 'b'.repeat(64) } };
  const events: Record<string, unknown>[] = [];
  Object.assign(ssm, { send: async () => ({ Parameter: { Value: 'c'.repeat(64) } }) });
  Object.assign(s3, { send: async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      if (command.input.IfNoneMatch && objects.has(command.input.Key!)) throw { $metadata: { httpStatusCode: 412 } };
      objects.set(command.input.Key!, String(command.input.Body)); return {};
    }
    if (command instanceof HeadObjectCommand) return { VersionId: 'fixture-v1', ContentLength: 100, ContentType: 'image/jpeg', ChecksumSHA256: Buffer.from(sha, 'hex').toString('base64') };
    if (command instanceof GetObjectCommand) {
      if (!objects.has(command.input.Key!)) throw { $metadata: { httpStatusCode: 404 } };
      return { Body: { transformToString: async () => objects.get(command.input.Key!)! } };
    }
    if (command instanceof ListObjectVersionsCommand) return { Versions: [...objects.keys()].filter(key => key.startsWith(command.input.Prefix!)).map(Key => ({ Key, VersionId: 'fixture-v1' })) };
    if (command instanceof DeleteObjectsCommand) { for (const item of command.input.Delete!.Objects!) objects.delete(item.Key!); return {}; }
    throw new Error('Unexpected storage command.');
  } });
  Object.assign(lambda, { send: async (command: { input: { Payload: Uint8Array; InvocationType?: string } }) => {
    if (command.input.InvocationType === 'Event') return {};
    events.push(JSON.parse(Buffer.from(command.input.Payload).toString()));
    return { Payload: Buffer.from(JSON.stringify(detection)) };
  } });
  const queries = new CloudImageQueries(s3, lambda, ssm, 'test-bucket', 'processor', 'inference');
  try {
    const reserved = await queries.reserve('alice', { purpose: 'lost-pet', options: { tags: ['collar'] }, file: { checksum: sha, size: 100, contentType: 'image/jpeg', key: 'incoming/other-user', mode: 'video' } });
    const key = new URL(reserved.upload.url).pathname.slice(1);
    assert.match(key, /^queries\/[a-f0-9-]{36}\/input$/);
    assert.equal(reserved.upload.headers['If-None-Match'], '*');
    objects.set(key, 'temporary image');
    await assert.rejects(queries.poll('bob', reserved.token), { status: 404 });
    await assert.rejects(queries.poll('alice', reserved.token + 'x'), { status: 404 });
    assert.deepEqual(await queries.poll('alice', reserved.token), { pending: true });
    await queries.start('alice', reserved.token);
    await queries.run(reserved.token); await queries.run(reserved.token);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.key, key); assert.equal(events[0]!.mode, 'image');
    assert.equal(objects.has(key), false);
    const result = await queries.poll('alice', reserved.token);
    assert.ok('detection' in result); assert.deepEqual(result.detection, detection);
    assert.deepEqual(result.window?.tags, ['collar']);
    await assert.rejects(queries.reserve('alice', { purpose: 'collection', file: { checksum: sha, size: 11 * 1024 * 1024, contentType: 'image/jpeg' } }), { status: 400 });
  } finally { s3.destroy(); lambda.destroy(); ssm.destroy(); }
});
