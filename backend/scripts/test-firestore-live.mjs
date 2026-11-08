import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { FirestoreMediaStore } from '../dist/cloud/firestore-media.js';

const projectId = process.env.ECOGUARD_LIVE_FIRESTORE_PROJECT;
if (process.env.ECOGUARD_ALLOW_LIVE_TESTS !== '1' || !/^fit3184-g80-ecoguard-[a-z0-9-]+$/.test(projectId ?? '') || process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Explicitly select an EcoGuard live test project and set ECOGUARD_ALLOW_LIVE_TESTS=1. Emulator addresses and unrelated projects are rejected.');
}
let auth;
if (process.env.ECOGUARD_USE_GCLOUD_AUTH === '1') {
  // Test-only existing user credential, never the deployed cross-cloud identity.
  const { stdout } = await promisify(execFile)(process.env.ECOGUARD_GCLOUD ?? 'gcloud', ['--configuration=ecoguard-fit3184', 'auth', 'print-access-token'], { env: { ...process.env, CLOUDSDK_CORE_DISABLE_FILE_LOGGING: '1' }, timeout: 15000 });
  const client = new OAuth2Client();
  client.setCredentials({ access_token: stdout.trim() }); // Short-lived token remains only in memory.
  auth = new GoogleAuth({ authClient: client, projectId });
}
const db = new Firestore({ projectId, ...(auth ? { auth } : {}) });
const namespace = `smoke_${randomUUID().replaceAll('-', '')}`;
console.log(`Live Firestore metadata smoke test: ${projectId}, namespace ${namespace}`);
const store = new FirestoreMediaStore(db, namespace);
try {
  const input = { filename: 'synthetic-test.png', checksum: 'd'.repeat(64), size: 100, contentType: 'image/png', visibility: 'private' };
  const results = await Promise.all([store.reserve('test-alice', input), store.reserve('test-alice', input)]);
  assert.equal(results[0].media.id, results[1].media.id);
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  const bob = await store.reserve('test-bob', input);
  assert.notEqual(bob.media.id, results[0].media.id);
  await assert.rejects(store.get(bob.media.id, 'test-alice'), { status: 404 });
  const item = results[0].media;
  assert.equal(await store.bindSource(item.id, { key: item.storageKey, version: 'synthetic-version-no-object-uploaded', checksum: input.checksum, size: input.size, contentType: input.contentType }), true);
  const ticket = await store.claim(item.id, 'b'.repeat(64));
  assert.ok(ticket);
  await store.beginDelete([item.id], 'test-alice');
  assert.equal(await store.fail(ticket, 'PROCESSING_FAILED'), false);
  assert.equal(await store.finishDelete(item.id), true);
  console.log('PASS: concurrent reservation, owner isolation, source metadata binding, processing claim, tombstone fencing and finalization. Synthetic metadata only; no S3 or ML inference claim.');
  console.log(process.env.ECOGUARD_USE_GCLOUD_AUTH === '1' ? 'Identity: existing local gcloud user; AWS federation is not verified.' : 'Identity: application default credentials; independently verify their source before claiming federation.');
} catch (error) {
  console.error('Live smoke test failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  try {
    // Only this run's generated fixture collections are eligible for cleanup.
    for (const name of ['media', 'checksums', 'outbox']) await db.recursiveDelete(db.collection(`${namespace}_${name}`));
    console.log('Removed this smoke run\'s synthetic collections.');
  } catch {
    console.error(`Fixture cleanup failed. Reconcile only collections with prefix ${namespace}_ in the selected project.`);
    process.exitCode = 1;
  } finally { await db.terminate(); }
}
