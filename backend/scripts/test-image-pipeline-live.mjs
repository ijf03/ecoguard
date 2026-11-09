import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { S3Client } from '@aws-sdk/client-s3';
import { FirestoreMediaStore } from '../dist/cloud/firestore-media.js';
import { S3MediaStorage } from '../dist/cloud/s3-media.js';
if (process.env.ECOGUARD_ALLOW_LIVE_TESTS !== '1' || !process.env.ECOGUARD_TEST_IMAGE_PATH) throw new Error('Explicitly enable live tests and provide a synthetic PNG fixture path.');
const { stdout } = await promisify(execFile)(process.env.ECOGUARD_GCLOUD ?? 'gcloud', ['--configuration=ecoguard-fit3184', 'auth', 'print-access-token'], { env: { ...process.env, CLOUDSDK_CORE_DISABLE_FILE_LOGGING: '1' }, timeout: 15000 });
const oauth = new OAuth2Client(); oauth.setCredentials({ access_token: stdout.trim() });
const projectId = 'fit3184-g80-ecoguard-dg26';
const db = new Firestore({ projectId, auth: new GoogleAuth({ authClient: oauth, projectId }) });
const store = new FirestoreMediaStore(db);
const client = new S3Client({ region: 'us-east-1' });
const storage = new S3MediaStorage(client, 'ecoguard-g80-media-851725503164-us-east-1');
const bytes = await readFile(process.env.ECOGUARD_TEST_IMAGE_PATH);
const owner = `synthetic-pipeline-${randomUUID()}`;
const expectInvalid = process.env.ECOGUARD_EXPECT_INVALID === '1';
let item;
try {
  item = (await store.reserve(owner, { filename: 'synthetic-cloud-pipeline-fixture.png', size: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex'), contentType: 'image/png', visibility: expectInvalid ? 'public' : 'private' })).media;
  const upload = await storage.upload(item);
  assert.equal((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes })).status, 200);
  let lastPhase;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const current = await store.get(item.id, owner);
    if (current.phase !== lastPhase) { console.log('S3-triggered pipeline state:', current.phase); lastPhase = current.phase; }
    if (['complete', 'failed', 'rejected'].includes(current.phase)) {
      if (expectInvalid) {
        assert.equal(current.phase, 'rejected');
        assert.equal(current.sourceVersion, undefined);
        assert.equal(current.thumbnailKey, undefined);
        await assert.rejects(store.get(item.id, 'another-owner'), { status: 404 });
        console.log('LIVE INVALID IMAGE PASS: real S3 event rejected undecodable bytes; no source binding, thumbnail or public read was permitted.');
        break;
      }
      assert.ok(current.sourceVersion, 'Full validation must bind the actual object version.');
      assert.ok(current.thumbnailKey, 'The image worker must publish a real thumbnail.');
      assert.equal(current.width, 960); assert.equal(current.height, 600);
      assert.equal(current.thumbnailWidth, 320); assert.equal(current.thumbnailHeight, 200);
      const thumbnail = await fetch(await storage.download(current, true));
      assert.equal(thumbnail.status, 200);
      const thumbnailBytes = Buffer.from(await thumbnail.arrayBuffer());
      assert.equal(thumbnailBytes.subarray(0, 2).toString('hex'), 'ffd8');
      assert.ok(thumbnailBytes.length < bytes.length);
      if (current.phase === 'failed') assert.equal(current.processingError, 'PROCESSOR_UNAVAILABLE');
      else assert.equal(current.phase, 'complete');
      console.log(`LIVE IMAGE PIPELINE PASS: actual S3 trigger -> Lambda -> Linux Pillow decode/compressed 320x200 thumbnail -> federated Firestore update. Inference state: ${current.processingStatus}; no inference success is claimed by a thumbnail test.`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok((expectInvalid ? ['rejected'] : ['complete', 'failed']).includes((await store.get(item.id, owner)).phase), 'Image pipeline did not finish within 120 seconds.');
} finally {
  if (item) {
    await store.beginDelete([item.id], owner);
    await storage.cleanup(item);
    await store.finishDelete(item.id);
    // Explicitly generated private fixtures only. Production deletion retains its tombstones.
    await db.collection('ecoguard_media').doc(item.id).delete();
    await db.collection('ecoguard_tombstones').doc(item.id).delete();
    const events = await db.collection('ecoguard_outbox').where('mediaId', '==', item.id).get();
    for (const event of events.docs) await event.ref.delete();
    console.log('Removed this run\'s synthetic source/thumbnail versions and metadata fixtures.');
  }
  client.destroy(); await db.terminate();
}
