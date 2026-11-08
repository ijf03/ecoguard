import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createCognitoAuth, sessionCookie } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { MediaService } from '../src/media/service.js';
import { SqliteRepository } from '../src/database/sqlite.js';
import { LocalStorage } from '../src/storage/local.js';
import { serve } from './http-helper.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const poolId = 'us-east-1_TestPool';
const clientId = 'testclient';
const issuer = `https://cognito-idp.us-east-1.amazonaws.com/${poolId}`;
const pair = await generateKeyPair('RS256');
const auth = createCognitoAuth({ userPoolId: poolId, clientId, frontendOrigin: 'http://127.0.0.1:5173' }, async () => pair.publicKey);
async function token(owner = 'alice', overrides: { issuer?: string; client?: string; use?: string; expires?: number; issued?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ client_id: overrides.client ?? clientId, token_use: overrides.use ?? 'access' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(overrides.issuer ?? issuer).setSubject(owner)
    .setIssuedAt(overrides.issued ?? now).setExpirationTime(overrides.expires ?? now + 3600).sign(pair.privateKey);
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');

test('signed access tokens enforce issuer, app client, token use, expiry, issue time and signature', async () => {
  assert.equal((await auth.verify(await token())).sub, 'alice');
  for (const overrides of [
    { issuer: 'https://attacker.example' }, { client: 'otherclient' }, { use: 'id' },
    { expires: Math.floor(Date.now() / 1000) - 20 }, { issued: Math.floor(Date.now() / 1000) + 3600 },
  ]) await assert.rejects(auth.verify(await token('alice', overrides)), /Sign in/);
  const valid = await token();
  const parts = valid.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'bob', client_id: clientId, token_use: 'access', iss: issuer, exp: Date.now() / 1000 + 3600, iat: Date.now() / 1000 })).toString('base64url');
  await assert.rejects(auth.verify(parts.join('.')), /Sign in/);
  await assert.rejects(auth.verify('not.a.token'), /Sign in/);
  assert.match(sessionCookie(valid, Date.now() / 1000 + 600, true), /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  assert.throws(() => sessionCookie('cookie; injected', Date.now() / 1000 + 600, false));
  assert.throws(() => createCognitoAuth({ userPoolId: poolId, clientId, frontendOrigin: 'http://public.example' }));
});

test('authenticated HTTP: owner isolation, scoped dedup, public reads, cookie media and whole-batch authorization', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-auth-'));
  const repo = new SqliteRepository(join(root, 'db.sqlite'));
  t.after(async () => { repo.close(); await rm(root, { recursive: true, force: true }); });
  const service = new MediaService(repo, new LocalStorage(join(root, 'files')), {
    create: async () => ({ bytes: Buffer.from('mock thumbnail'), width: 1, height: 1, originalWidth: 1, originalHeight: 1 }),
  });
  const call = await serve(t, createApp({ media: service, auth }));
  const alice = { Authorization: `Bearer ${await token('alice')}` };
  const bob = { Authorization: `Bearer ${await token('bob')}` };
  const post = (path: string, body: unknown, headers: Record<string, string>) => call(path, 'POST', Buffer.from(JSON.stringify(body)), { ...headers, 'Content-Type': 'application/json' });
  for (const [path, method] of [['/api/health', 'GET'], ['/api/media', 'GET'], ['/api/media', 'POST'], ['/api/search', 'POST'], ['/api/search/image', 'POST'], ['/api/search/lost-pet/image', 'POST'], ['/api/search/thumbnail', 'POST'], ['/api/media/tags', 'POST'], ['/api/media/delete', 'POST']] as const) {
    assert.equal((await call(path, method)).status, 401, path);
  }
  assert.equal((await call('/api/media', 'GET', undefined, { Authorization: 'Bearer invalid' })).status, 401);
  assert.equal((await post('/api/auth/session', {}, { ...alice, Origin: 'https://attacker.example' })).status, 403);
  const session = await post('/api/auth/session', {}, { ...alice, Origin: auth.frontendOrigin });
  assert.equal(session.status, 200);
  const cookie = (session.headers['set-cookie'] as string[])[0]!;
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const cookieHeaders = { Cookie: cookie.split(';')[0]! };
  const a = (await call('/api/media', 'POST', png, { ...alice, 'Content-Type': 'image/png', 'X-Filename': 'alice.png', 'X-Owner': 'bob' })).json.media;
  const bResponse = await call('/api/media', 'POST', png, { ...bob, 'Content-Type': 'image/png', 'X-Filename': 'bob.png' });
  assert.equal(bResponse.status, 201);
  const b = bResponse.json.media;
  assert.notEqual(a.id, b.id); // Same bytes owned by two users do not reveal/reuse private records.
  assert.equal((await call('/api/media', 'POST', png, { ...alice, 'Content-Type': 'image/png' })).json.duplicate, true);
  assert.equal((await service.get(a.id)).ownerId, 'alice');
  assert.ok(!('ownerId' in a) && !('storageKey' in a) && !('thumbnailKey' in a));
  assert.deepEqual((await call('/api/media', 'GET', undefined, bob)).json.media.map((m: { id: string }) => m.id), [b.id]);
  for (const path of [`/api/media/${a.id}`, a.originalUrl, a.thumbnailUrl]) assert.equal((await call(path, 'GET', undefined, bob)).status, 404);
  assert.equal((await post('/api/search/thumbnail', { thumbnailUrl: a.thumbnailUrl }, bob)).status, 404);
  assert.equal((await call(a.originalUrl, 'GET', undefined, cookieHeaders)).status, 200);
  assert.equal((await call(a.thumbnailUrl, 'GET', undefined, cookieHeaders)).status, 200);
  assert.equal((await call(a.originalUrl, 'HEAD')).status, 401);
  const publicMedia = (await call('/api/media', 'POST', Buffer.concat([png, Buffer.from('public')]), { ...alice, 'Content-Type': 'image/png', 'X-Visibility': 'public' })).json.media;
  await post('/api/media/tags', { urls: [a.originalUrl, publicMedia.originalUrl], tags: ['cat'], operation: 1 }, alice);
  await post('/api/media/tags', { urls: [b.originalUrl], tags: ['cat'], operation: 1 }, bob);
  const found = await post('/api/search', { tags: { cat: 1 } }, bob);
  assert.deepEqual(new Set(found.json.media.map((m: { id: string }) => m.id)), new Set([b.id, publicMedia.id]));
  assert.equal(found.json.media.find((m: { id: string }) => m.id === publicMedia.id).canEdit, false);
  assert.equal((await call(publicMedia.originalUrl, 'GET', undefined, bob)).status, 200);
  assert.equal((await post(`/api/media/${publicMedia.id}/process`, {}, bob)).status, 404);
  assert.equal((await post('/api/media/tags', { urls: [b.originalUrl, publicMedia.originalUrl], tags: ['must-not-save'], operation: 1 }, bob)).status, 404);
  assert.ok(!(await service.get(b.id)).manualTags.includes('must-not-save'));
  assert.equal((await post('/api/media/delete', { urls: [b.originalUrl, publicMedia.originalUrl] }, bob)).status, 404);
  assert.equal((await call(b.originalUrl, 'GET', undefined, bob)).status, 200);
  assert.equal((await post('/api/media/delete', { urls: [a.originalUrl] }, alice)).status, 200);
  assert.equal((await call(b.originalUrl, 'GET', undefined, bob)).status, 200);
  assert.equal((await repo.findChecksum(b.checksum, 'bob'))?.id, b.id);
  assert.equal((await call('/api/auth/session', 'DELETE', undefined, { ...cookieHeaders, Origin: auth.frontendOrigin })).status, 200);
  assert.equal((await call('/api/media', 'GET')).status, 401);
});

test('legacy SQLite migration preserves unowned records and allows independent owner checksums', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-migration-'));
  const filename = join(root, 'db.sqlite');
  const old = new DatabaseSync(filename);
  old.exec('CREATE TABLE media (id TEXT PRIMARY KEY, checksum TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, document TEXT NOT NULL)');
  const legacy = { id: randomUUID(), filename: 'legacy.png', checksum: 'a'.repeat(64), storageKey: randomUUID(), contentType: 'image/png' as const, size: 10, createdAt: new Date().toISOString(), visibility: 'private' as const, processingStatus: 'complete' as const, species: {}, manualTags: [] };
  old.prepare('INSERT INTO media VALUES (?, ?, ?, ?)').run(legacy.id, legacy.checksum, legacy.createdAt, JSON.stringify(legacy)); old.close();
  const repo = new SqliteRepository(filename);
  t.after(async () => { repo.close(); await rm(root, { recursive: true, force: true }); });
  assert.deepEqual(await repo.get(legacy.id), legacy);
  assert.equal(await repo.findChecksum(legacy.checksum, 'alice'), undefined);
  const owned = { ...legacy, id: randomUUID(), ownerId: 'alice' };
  await repo.save(owned);
  assert.equal((await repo.findChecksum(legacy.checksum, 'alice'))?.id, owned.id);
  const service = new MediaService(repo, { put: async () => {}, get: async () => png, remove: async () => {} });
  await assert.rejects(service.get(legacy.id, 'alice'), /Media not found/);
  await assert.rejects(repo.save({ ...owned, ownerId: 'bob' }), /immutable/);
});
