import type { FirestoreMediaStore } from './firestore-media.js';
import type { S3MediaStorage } from './s3-media.js';
function missingObject(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === 'NotFound' || value.name === 'NoSuchKey' || value.$metadata?.httpStatusCode === 404;
}
export function createRecovery(options: { store: FirestoreMediaStore; storage: Pick<S3MediaStorage, 'head' | 'cleanup'>; enqueue: (id: string) => Promise<void>; now?: () => number }) {
  const { store, storage, enqueue } = options;
  const now = options.now ?? Date.now;
  return async () => {
    let inspected = 0;
    let failures = 0;
    for (const kind of ['media', 'tombstones'] as const) {
      const cursor = await store.recoveryCursor(kind);
      const page = await store.recoveryPage(kind, cursor);
      let failedPage = false;
      for (const item of page.items) {
        inspected++;
        try {
          if (item.phase === 'deleted') {
            if (item.cleanupAfter! <= now()) { await storage.cleanup(item); await store.finishDelete(item.id); }
          } else if (item.phase === 'deleting') {
            await storage.cleanup(item); await store.finishDelete(item.id);
          } else if (item.phase === 'ready' || item.phase === 'processing' && (!item.lease || item.lease.until <= now())) {
            await enqueue(item.id);
          } else if (item.phase === 'awaiting-upload' && item.uploadExpiresAt <= now()) {
            try { await storage.head(item); await enqueue(item.id); }
            catch (error) {
              if (!missingObject(error)) throw error; // Permission/network failure must never mean "file absent".
              if (await store.expireUnuploaded(item.id)) { await storage.cleanup(item); await store.finishDelete(item.id); }
            }
          }
        } catch { failedPage = true; failures++; }
      }
      // A failed page stays eligible for the next bounded retry instead of silently losing work.
      if (!failedPage) await store.saveRecoveryCursor(kind, page.cursor);
    }
    if (failures) throw new Error('Some cloud recovery operations failed; retained state remains retryable.');
    return { inspected };
  };
}
