import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreMediaStore } from './firestore-media.js';

/** IAM-invoked deployment check only. No HTTP route, access tokens or real animal results. */
export async function handler() {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || !process.env.AWS_SESSION_TOKEN || process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Invoke this check inside the configured AWS Lambda execution role.');
  }
  const projectId = 'fit3184-g80-ecoguard-dg26';
  // Explicit keyFilename selects the external-account configuration rather than a developer's ADC.
  // This file contains only WIF endpoints/identifiers; there is no private key.
  const db = new Firestore({ projectId, keyFilename: fileURLToPath(new URL('../../config/aws-wif.json', import.meta.url)) });
  const namespace = `probe_${randomUUID().replaceAll('-', '')}`;
  const store = new FirestoreMediaStore(db, namespace);
  try {
    const input = { filename: 'federation-probe.png', checksum: 'e'.repeat(64), size: 100, contentType: 'image/png', visibility: 'private' } as const;
    const [first, second] = await Promise.all([store.reserve('federation-probe-owner', input), store.reserve('federation-probe-owner', input)]);
    if (first.media.id !== second.media.id || first.duplicate === second.duplicate) throw new Error('Cross-cloud reservation did not deduplicate.');
    const saved = await store.get(first.media.id, 'federation-probe-owner');
    if (saved.checksum !== input.checksum) throw new Error('Cross-cloud metadata round trip failed.');
    return { ok: true, projectId, authentication: 'AWS execution role -> GCP workload identity federation', metadataRoundTrip: true, concurrentDeduplication: true, syntheticMetadataOnly: true };
  } finally {
    // This probe creates no S3 objects. Remove only its unique synthetic metadata collections.
    try {
      for (const name of ['media', 'checksums', 'outbox']) await db.recursiveDelete(db.collection(`${namespace}_${name}`));
    } finally { await db.terminate(); }
  }
}
