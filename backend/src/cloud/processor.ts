import type { S3Event } from 'aws-lambda';
import type { Detection } from '../processing/detector.js';
import type { CloudMedia, FirestoreMediaStore } from './firestore-media.js';
import type { S3MediaStorage } from './s3-media.js';

type Thumbnail = { key: string; width: number; height: number; originalWidth: number; originalHeight: number };
export type ValidatedImage = { valid: false; error: 'INVALID_MEDIA' } | { valid: true; checksum: string; size: number; contentType: string; thumbnail: Thumbnail };
export interface ProcessorOptions {
  store: FirestoreMediaStore;
  storage: Pick<S3MediaStorage, 'bucket' | 'head' | 'cleanup'>;
  validate: (item: CloudMedia, version: string) => Promise<ValidatedImage>;
  model?: { sha256: string; detect: (item: CloudMedia) => Promise<Detection> };
}
export function createProcessor({ store, storage, validate, model }: ProcessorOptions) {
  return async (event: S3Event | { mediaId?: string }) => {
    const jobs: { id: string; key?: string; version?: string }[] = [];
    if ('Records' in event) {
      for (const record of event.Records) {
        if (record.eventSource !== 'aws:s3' || !record.eventName.startsWith('ObjectCreated:') || record.s3.bucket.name !== storage.bucket) continue;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        const match = /^incoming\/[a-f0-9]{64}\/([a-f0-9-]{36})$/.exec(key);
        if (match && record.s3.object.versionId) jobs.push({ id: match[1]!, key, version: record.s3.object.versionId });
      }
    } else if (event.mediaId) jobs.push({ id: event.mediaId });
    for (const job of jobs) {
      const item = await store.readForWorker(job.id);
      if (!item || job.key && job.key !== item.storageKey) continue;
      if (item.phase === 'deleting' || item.phase === 'deleted') {
        await storage.cleanup(item);
        if (item.phase === 'deleting') await store.finishDelete(item.id);
        continue;
      }
      if (['complete', 'failed', 'rejected'].includes(item.phase)) continue;
      // Videos require the separate FFmpeg/inference package; never claim image validation proves codec/duration.
      if (item.contentType === 'video/mp4') { await store.markProcessorUnavailable(item.id); continue; }
      const version = job.version ?? item.sourceVersion ?? (await storage.head(item)).version;
      if (!version) throw new Error('Processing requires a versioned source.');
      const result = await validate(item, version);
      if (!result.valid) { await store.rejectUpload(item.id); continue; }
      await store.bindSource(item.id, { key: item.storageKey, version, checksum: result.checksum, size: result.size, contentType: result.contentType });
      const attached = await store.attachThumbnail(item.id, version, result.thumbnail);
      if (!attached) { await storage.cleanup(item); continue; } // A concurrent deletion won; remove late artifacts.
      if (!model) { await store.markProcessorUnavailable(item.id); continue; }
      const ticket = await store.claim(item.id, model.sha256);
      if (!ticket) continue;
      try {
        const current = await store.readForWorker(item.id);
        if (current) await store.complete(ticket, await model.detect(current));
      } catch {
        await store.fail(ticket, 'PROCESSING_FAILED');
      }
    }
    return { accepted: jobs.length };
  };
}
