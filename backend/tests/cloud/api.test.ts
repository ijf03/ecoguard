import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { generateKeyPair, SignJWT } from 'jose';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createCognitoAuth } from '../../src/auth.js';
import { createCloudApi } from '../../src/cloud/api.js';
import { FirestoreMediaStore } from '../../src/cloud/firestore-media.js';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('This test suite requires the loopback Firestore emulator.');
const keys = await generateKeyPair('RS256');
const pool = 'us-east-1_TestPool';
const auth = createCognitoAuth({ userPoolId: pool, clientId: 'testclient', frontendOrigin: 'http://127.0.0.1:5173' }, async () => keys.publicKey);
async function token(owner: string) {
  return new SignJWT({ client_id: 'testclient', token_use: 'access' }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`https://cognito-idp.us-east-1.amazonaws.com/${pool}`).setSubject(owner).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
}
const input = { filename: 'fixture.png', checksum: 'a'.repeat(64), size: 100, contentType: 'image/png', visibility: 'private' };

test('API Gateway adapter verifies JWT itself, scopes uploads/collection, hides internal fields and validates complete batches', async t => {
  const db = new Firestore({ projectId: 'demo-ecoguard-g80' });
  const namespace = `api_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => { for (const name of ['media', 'checksums', 'outbox', 'tombstones', 'control']) await db.recursiveDelete(db.collection(`${namespace}_${name}`)); await db.terminate(); });
  const store = new FirestoreMediaStore(db, namespace);
  const signedUploads: string[] = [];
  const removed: string[] = [];
  let queryLost = false;
  let queryEmpty = false;
  const handle = createCloudApi({ store, auth, processingAvailable: false, schedule: async () => {}, storage: {
    upload: async item => { signedUploads.push(item.id); return { url: 'https://storage.test/upload', headers: { 'Content-Type': item.contentType, 'x-amz-checksum-sha256': Buffer.from(item.checksum, 'hex').toString('base64'), 'If-None-Match': '*' } }; },
    download: async item => item.sourceVersion ? `https://storage.test/download/${item.id}` : undefined,
    head: async () => ({ version: 'version-1', size: input.size, checksum: Buffer.from(input.checksum, 'hex').toString('base64'), contentType: input.contentType }),
    cleanup: async item => { removed.push(item.id); },
  }, queries: {
    reserve: async owner => ({ owner }), start: async () => {},
    poll: async () => ({ detection: { species: queryEmpty ? {} : { cat: 3 }, model: { identity: 'query fixture', version: '1', weightsSha256: 'a'.repeat(64), confidence: 0.25 } },
      ...(queryLost ? { window: { since: '2020-01-01T00:00:00.000Z', until: '2099-01-01T00:00:00.000Z', tags: [] } } : {}) }),
  } });
  const alice = await token('alice');
  const bob = await token('bob');
  async function call(path: string, method = 'GET', body?: unknown, bearer?: string, extra: Record<string, string> = {}) {
    const result = await handle({ rawPath: path, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false, requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: 'forged-owner' } } } } } as unknown as APIGatewayProxyEventV2);
    assert.equal(typeof result, 'object');
    const response = result as { statusCode: number; body?: string; headers?: Record<string, string> };
    return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : {}, headers: response.headers };
  }
  assert.equal((await call('/api/uploads', 'OPTIONS', undefined, undefined, { origin: auth.frontendOrigin })).status, 204);
  assert.equal((await call('/api/health')).status, 401); // Forged Gateway context is not identity.
  assert.equal((await call('/api/health', 'GET', undefined, 'not-a-token')).status, 401);
  assert.equal((await call('/api/health', 'GET', undefined, alice)).status, 200);
  assert.equal((await call('/api/uploads', 'POST', input, alice, { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await call('/api/uploads', 'POST', { ...input, ownerId: 'bob' }, alice)).status, 400);
  const upload = await call('/api/uploads', 'POST', input, alice);
  assert.equal(upload.status, 201);
  assert.equal(upload.body.duplicate, false);
  assert.equal(upload.body.upload.headers['If-None-Match'], '*');
  for (const key of ['ownerId', 'storageKey', 'lease', 'sourceVersion', 'generation']) assert.equal(key in upload.body.media, false);
  const id = upload.body.media.id as string;
  assert.equal((await store.get(id, 'alice')).ownerId, 'alice');
  assert.equal((await call('/api/uploads', 'POST', input, alice)).body.media.id, id);
  const other = await call('/api/uploads', 'POST', input, bob);
  assert.notEqual(other.body.media.id, id);
  assert.equal((await call('/api/media', 'GET', undefined, alice)).body.media.length, 1);
  assert.equal((await call(`/api/media/${other.body.media.id}`, 'GET', undefined, alice)).status, 404);
  assert.equal((await call(`/api/uploads/${other.body.media.id}/complete`, 'POST', {}, alice)).status, 404);
  assert.equal((await call(`/api/uploads/${id}/complete`, 'POST', {}, alice)).status, 202);
  assert.equal((await store.get(id, 'alice')).phase, 'awaiting-upload'); // Completion never fabricates validation/inference.
  const urls = [`/api/media/${id}/file`, `/api/media/${other.body.media.id}/file`];
  assert.equal((await call('/api/media/tags', 'POST', { urls, tags: ['cat'], operation: 1 }, alice)).status, 404);
  assert.deepEqual((await store.get(id, 'alice')).manualTags, []);
  assert.equal((await call('/api/media/delete', 'POST', { urls }, alice)).status, 404);
  assert.equal(removed.length, 0);
  assert.equal((await call(`/api/media/${id}/file`, 'GET', undefined, alice)).status, 404);
  assert.equal((await call(`/api/media/${id}/process`, 'POST', {}, alice)).status, 503);
  assert.equal((await store.get(id, 'alice')).generation, 1); // Unconfigured retry makes no metadata changes.
  const item = await store.get(id, 'alice');
  await store.bindSource(id, { key: item.storageKey, version: 'version-1', checksum: input.checksum, size: input.size, contentType: input.contentType });
  assert.equal((await call(`/api/media/${id}/file`, 'GET', undefined, alice)).status, 302);
  const tagged = await call('/api/media/tags', 'POST', { urls: [urls[0]], tags: ['cat'], operation: 1 }, alice);
  assert.deepEqual(tagged.body.media[0].manualTags, ['cat']);
  assert.equal((await call('/api/search', 'POST', { tags: { cat: 1 } }, alice)).body.media.length, 1);
  assert.equal((await call('/api/search/lost-pet', 'POST', { species: 'cat' }, alice)).body.media.length, 0);
  assert.equal((await call('/api/queries', 'POST', {}, alice)).body.owner, 'alice');
  assert.equal((await call('/api/queries/result', 'POST', { token: 'fixture-token' }, alice)).body.media.length, 1); // Three cats in the query still require only the cat species.
  queryLost = true;
  assert.equal((await call('/api/queries/result', 'POST', { token: 'fixture-token' }, alice)).body.media.length, 0); // Private media never enters lost-pet results.
  queryLost = false; queryEmpty = true;
  assert.equal((await call('/api/queries/result', 'POST', { token: 'fixture-token' }, alice)).body.media.length, 0);
  assert.equal((await call('/api/media/delete', 'POST', { urls: [urls[0]] }, alice)).body.deleted, 1);
  assert.deepEqual(removed, [id]);
  assert.equal((await call('/api/auth/session', 'DELETE')).status, 200);
  assert.equal(signedUploads.length, 3);
});
