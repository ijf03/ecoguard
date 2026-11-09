import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { FirestoreMediaStore } from '../dist/cloud/firestore-media.js';
import { S3MediaStorage } from '../dist/cloud/s3-media.js';

if (process.env.ECOGUARD_ALLOW_LIVE_TESTS !== '1') throw new Error('Explicit live-test opt-in is required.');
const manifest = JSON.parse(await readFile(new URL('../.build/inference-manifest.json', import.meta.url), 'utf8'));
const { stdout } = await promisify(execFile)(process.env.ECOGUARD_GCLOUD ?? 'gcloud', ['--configuration=ecoguard-fit3184', 'auth', 'print-access-token'], { env: { ...process.env, CLOUDSDK_CORE_DISABLE_FILE_LOGGING: '1' }, timeout: 20000 });
const oauth = new OAuth2Client(); oauth.setCredentials({ access_token: stdout.trim() });
const projectId = 'fit3184-g80-ecoguard-dg26';
const db = new Firestore({ projectId, auth: new GoogleAuth({ authClient: oauth, projectId }) });
const store = new FirestoreMediaStore(db);
const s3 = new S3Client({ region: 'us-east-1' });
const lambda = new LambdaClient({ region: 'us-east-1' });
const storage = new S3MediaStorage(s3, 'ecoguard-g80-media-851725503164-us-east-1');
const owner = `synthetic-model-${randomUUID()}`;
const evidence = { checkedAt: new Date().toISOString(), projectId, modelSha256: manifest.modelSha256, cases: [] };
const created = [];
try {
  for (const mode of ['image', 'video']) {
    const fixture = manifest.linuxPreflightFixtures[mode];
    const direct = await lambda.send(new InvokeCommand({ FunctionName: 'ecoguard-g80-inference', Payload: Buffer.from(JSON.stringify(fixture.event)) }));
    assert.equal(direct.FunctionError, undefined, 'Native Lambda invocation failed.');
    const detected = JSON.parse(Buffer.from(direct.Payload).toString());
    assert.deepEqual(detected, fixture.observed, 'Lambda result must match recorded native preflight.');
    assert.equal(detected.species.dog, 1);
    const source = await s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: fixture.event.key, VersionId: fixture.event.version }));
    const bytes = Buffer.from(await source.Body.transformToByteArray());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.event.checksum);
    const reservation = { filename: `synthetic-model-fixture.${mode === 'image' ? 'jpg' : 'mp4'}`, checksum: fixture.event.checksum, size: bytes.length, contentType: fixture.event.contentType, visibility: 'private' };
    const item = (await store.reserve(owner, reservation)).media; created.push(item);
    const upload = await storage.upload(item);
    assert.equal((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes })).status, 200);
    assert.equal((await store.reserve(owner, reservation)).duplicate, true);
    let current;
    const deadline = Date.now() + 180000;
    do {
      current = await store.get(item.id, owner);
      if (['complete', 'failed', 'rejected'].includes(current.phase)) break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    } while (Date.now() < deadline);
    assert.equal(current.phase, 'complete', `Actual S3 pipeline did not complete: ${current.processingError ?? current.phase}`);
    assert.deepEqual(current.species, detected.species);
    assert.equal(current.detectionModel.weightsSha256, manifest.modelSha256);
    await assert.rejects(store.get(item.id, 'unrelated-test-user'), { status: 404 });
    assert.ok((await store.search(owner, { dog: 1 })).some(result => result.id === item.id));
    assert.ok(!(await store.search(owner, { dog: 2 })).some(result => result.id === item.id));
    const downloaded = await fetch(await storage.download(current));
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    if (mode === 'image') {
      assert.ok(current.thumbnailKey);
      assert.ok(Math.abs(current.thumbnailWidth / current.thumbnailHeight - current.width / current.height) < 0.02);
      const thumb = await fetch(await storage.download(current, true));
      assert.equal(thumb.status, 200); assert.ok((await thumb.arrayBuffer()).byteLength < bytes.length);
    } else {
      assert.deepEqual(current.sampledAt, [0, 10]); assert.equal(current.duration, 11);
      const range = await fetch(await storage.download(current), { headers: { Range: 'bytes=0-31' } });
      assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32);
    }
    evidence.cases.push({ mode, nativeLambda: detected, s3TriggeredPipeline: { phase: current.phase, species: current.species, model: current.detectionModel, duration: current.duration, sampledAt: current.sampledAt }, ownerIsolation: true, countSearch: true, originalRetrieval: true });
    console.log(`LIVE ${mode.toUpperCase()} PASS: native inference, S3-triggered processing, keyless Firestore, deduplication, ownership, search and retrieval.`);
  }
  await writeFile(new URL('../.build/model-live-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
} finally {
  for (const item of created) {
    await store.beginDelete([item.id], owner); await storage.cleanup(item); await store.finishDelete(item.id);
    assert.equal((await db.collection('ecoguard_media').doc(item.id).get()).exists, false);
    await db.collection('ecoguard_tombstones').doc(item.id).delete();
  }
  s3.destroy(); lambda.destroy(); await db.terminate();
  console.log('Removed only this run’s generated media, thumbnails, checksum reservations and outbox events.');
}
