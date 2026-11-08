import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Firestore, type Transaction } from '@google-cloud/firestore';
import type { Media } from '../media/contracts.js';
import { ApiError } from '../http/errors.js';
import { matches } from '../media/search.js';
import { validateDetection, type Detection } from '../processing/detector.js';

type Phase = 'awaiting-upload' | 'ready' | 'processing' | 'complete' | 'failed' | 'deleting' | 'deleted';
export interface CloudMedia extends Media {
  ownerId: string;
  phase: Phase;
  revision: number;
  generation: number;
  uploadExpiresAt: number;
  sourceVersion?: string;
  lease?: { token: string; until: number; generation: number; modelSha256: string };
}
export interface Reservation {
  filename: string;
  checksum: string;
  size: number;
  contentType: Media['contentType'];
  visibility: Media['visibility'];
}
export interface ProcessingTicket {
  id: string;
  sourceVersion: string;
  generation: number;
  token: string;
  modelSha256: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const missing = () => new ApiError(404, 'MEDIA_NOT_FOUND', 'Media not found.');
const conflict = (message: string) => new ApiError(409, 'STATE_CONFLICT', message);
const visible = (item: CloudMedia) => item.phase !== 'deleting' && item.phase !== 'deleted';
const publiclyReadable = (item: CloudMedia) => item.visibility === 'public' && item.phase !== 'awaiting-upload';
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Server-only metadata boundary. IAM authenticates the workload; callers supply only verified Cognito subjects. */
export class FirestoreMediaStore {
  constructor(private readonly db: Firestore, private readonly namespace = 'ecoguard', private readonly now = Date.now) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(namespace)) throw new Error('Invalid Firestore namespace.');
  }
  private collection(name: string) { return this.db.collection(`${this.namespace}_${name}`); }
  private media(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw missing();
    return this.collection('media').doc(id);
  }
  private reservation(ownerId: string, checksum: string) { return this.collection('checksums').doc(hash(`${ownerId}\0${checksum}`)); }
  private owner(owner: string) {
    if (!owner || owner.length > 128 || /[\x00-\x1f]/.test(owner)) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  }
  private outbox(tx: Transaction, item: CloudMedia, kind: 'upload' | 'update') {
    // One committed event per media revision. Delivery is at-least-once, never exactly-once email.
    tx.create(this.collection('outbox').doc(`${item.id}_${item.revision}`), {
      mediaId: item.id, ownerId: item.ownerId, revision: item.revision, kind,
      visibility: item.visibility, species: item.species, manualTags: item.manualTags,
      createdAt: new Date(this.now()).toISOString(), state: 'pending',
    });
  }
  async reserve(ownerId: string, input: Reservation): Promise<{ media: CloudMedia; duplicate: boolean }> {
    this.owner(ownerId);
    if (!/^[a-f0-9]{64}$/.test(input.checksum) || !Number.isSafeInteger(input.size) || input.size < 1 ||
        input.size > (input.contentType === 'video/mp4' ? 50 : 10) * 1024 * 1024 ||
        !['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(input.contentType) ||
        !['public', 'private'].includes(input.visibility) || typeof input.filename !== 'string' ||
        !input.filename.trim() || input.filename.length > 255 || /[\x00-\x1f\\/]/.test(input.filename)) {
      throw new ApiError(400, 'INVALID_UPLOAD', 'Supply a valid filename, SHA-256, MIME type, visibility and file size.');
    }
    // IDs/time remain stable when Firestore reruns a contended transaction callback.
    const id = randomUUID();
    const now = this.now();
    return this.db.runTransaction(async tx => {
      const reservation = this.reservation(ownerId, input.checksum);
      const pointer = await tx.get(reservation);
      let old: CloudMedia | undefined;
      if (pointer.exists) {
        const snapshot = await tx.get(this.media(pointer.get('mediaId') as string));
        old = snapshot.data() as CloudMedia | undefined;
        if (old && visible(old) && !(old.phase === 'awaiting-upload' && old.uploadExpiresAt <= now)) {
          return { media: old, duplicate: true };
        }
        // A tombstone retains its checksum until physical cleanup finishes.
        if (old?.phase === 'deleting') throw conflict('Deletion cleanup is pending. Retry after cleanup.');
      }
      if (old && old.phase === 'awaiting-upload') {
        tx.set(this.media(old.id), { ...old, phase: 'deleting', revision: old.revision + 1 });
      }
      const item: CloudMedia = {
        ...input, id, ownerId, storageKey: `incoming/${hash(ownerId)}/${id}`,
        mediaType: input.contentType === 'video/mp4' ? 'video' : 'image',
        createdAt: new Date(now).toISOString(), uploadExpiresAt: now + 15 * 60_000,
        phase: 'awaiting-upload', revision: 1, generation: 1,
        processingStatus: 'pending', species: {}, manualTags: [],
      };
      tx.create(this.media(id), item);
      tx.set(reservation, { mediaId: id });
      return { media: item, duplicate: false };
    });
  }
  async get(id: string, ownerId: string, mutation = false): Promise<CloudMedia> {
    this.owner(ownerId);
    const item = (await this.media(id).get()).data() as CloudMedia | undefined;
    if (!item || !visible(item) || (item.ownerId !== ownerId && (mutation || !publiclyReadable(item)))) throw missing();
    return item;
  }
  /** Called only after trusted storage validation of the actual object bytes; client digests are not proof. */
  async bindSource(id: string, source: { key: string; version: string; checksum: string; size: number; contentType: string }): Promise<boolean> {
    if (!source.version || source.version.length > 1024) throw conflict('A versioned source object is required.');
    return this.db.runTransaction(async tx => {
      const ref = this.media(id);
      const item = (await tx.get(ref)).data() as CloudMedia | undefined;
      if (!item || !visible(item)) return false;
      if (item.storageKey !== source.key || item.checksum !== source.checksum || item.size !== source.size || item.contentType !== source.contentType) {
        throw new ApiError(422, 'UPLOAD_MISMATCH', 'Uploaded object does not match its reservation.');
      }
      if (item.sourceVersion) {
        if (item.sourceVersion !== source.version) throw conflict('This upload already has an immutable source version.');
        return false;
      }
      if (item.phase !== 'awaiting-upload') throw conflict('Upload is not awaiting an object.');
      tx.set(ref, { ...item, sourceVersion: source.version, phase: 'ready', revision: item.revision + 1 });
      return true;
    });
  }
  async claim(id: string, modelSha256: string, leaseMs = 14 * 60_000): Promise<ProcessingTicket | undefined> {
    if (!/^[a-f0-9]{64}$/.test(modelSha256) || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 15 * 60_000) throw new Error('Invalid processing lease.');
    const token = randomUUID();
    return this.db.runTransaction(async tx => {
      const ref = this.media(id);
      const item = (await tx.get(ref)).data() as CloudMedia | undefined;
      const now = this.now();
      if (!item?.sourceVersion || !['ready', 'processing'].includes(item.phase) || item.lease && item.lease.until > now) return undefined;
      const lease = { token, until: now + leaseMs, generation: item.generation, modelSha256 };
      tx.set(ref, { ...item, phase: 'processing', lease, processingStatus: 'pending', revision: item.revision + 1 });
      return { id, sourceVersion: item.sourceVersion, generation: item.generation, token, modelSha256 };
    });
  }
  private current(item: CloudMedia | undefined, ticket: ProcessingTicket): item is CloudMedia {
    return !!item && item.phase === 'processing' && item.sourceVersion === ticket.sourceVersion &&
      item.generation === ticket.generation && item.lease?.token === ticket.token &&
      item.lease.generation === ticket.generation && item.lease.modelSha256 === ticket.modelSha256 && item.lease.until > this.now();
  }
  async complete(ticket: ProcessingTicket, detection: Detection, thumbnail?: { key: string; width: number; height: number; originalWidth: number; originalHeight: number }): Promise<boolean> {
    validateDetection(detection);
    if (detection.model.weightsSha256 !== ticket.modelSha256) throw new Error('Processing model digest changed.');
    if (thumbnail && (!thumbnail.key.startsWith(`thumbnails/${ticket.id}/${ticket.token}/`) ||
        [thumbnail.width, thumbnail.height, thumbnail.originalWidth, thumbnail.originalHeight].some(n => !Number.isSafeInteger(n) || n < 1))) throw new Error('Invalid versioned thumbnail.');
    return this.db.runTransaction(async tx => {
      const ref = this.media(ticket.id);
      const item = (await tx.get(ref)).data() as CloudMedia | undefined;
      if (!this.current(item, ticket)) return false;
      if (item.contentType !== 'video/mp4' && !thumbnail && !item.thumbnailKey) throw new Error('Images require a completed thumbnail before publication.');
      const completed: CloudMedia = { ...item, species: detection.species, detectionModel: detection.model, phase: 'complete', processingStatus: 'complete', revision: item.revision + 1 };
      delete completed.lease;
      delete completed.processingError;
      if (thumbnail) Object.assign(completed, { thumbnailKey: thumbnail.key, thumbnailWidth: thumbnail.width, thumbnailHeight: thumbnail.height, width: thumbnail.originalWidth, height: thumbnail.originalHeight });
      tx.set(ref, completed);
      this.outbox(tx, completed, item.generation === 1 ? 'upload' : 'update');
      return true;
    });
  }
  async fail(ticket: ProcessingTicket, code: 'INVALID_MEDIA' | 'PROCESSOR_UNAVAILABLE' | 'PROCESSING_FAILED'): Promise<boolean> {
    if (!['INVALID_MEDIA', 'PROCESSOR_UNAVAILABLE', 'PROCESSING_FAILED'].includes(code)) throw new Error('Invalid failure code.');
    return this.db.runTransaction(async tx => {
      const ref = this.media(ticket.id);
      const item = (await tx.get(ref)).data() as CloudMedia | undefined;
      if (!this.current(item, ticket)) return false;
      const failed: CloudMedia = { ...item, phase: 'failed', processingStatus: 'failed', processingError: code, revision: item.revision + 1 };
      delete failed.lease;
      tx.set(ref, failed);
      return true;
    });
  }
  async retry(id: string, ownerId: string): Promise<CloudMedia> {
    this.owner(ownerId);
    return this.db.runTransaction(async tx => {
      const ref = this.media(id);
      const item = (await tx.get(ref)).data() as CloudMedia | undefined;
      if (!item || !visible(item) || item.ownerId !== ownerId) throw missing();
      if (!item.sourceVersion || item.phase === 'processing' && item.lease && item.lease.until > this.now()) throw conflict('Upload is incomplete or processing is still active.');
      const next: CloudMedia = { ...item, phase: 'ready', processingStatus: 'pending', species: {}, generation: item.generation + 1, revision: item.revision + 1 };
      delete next.lease; delete next.processingError; delete next.detectionModel;
      tx.set(ref, next);
      return next;
    });
  }
  private ids(ids: string[]) {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new ApiError(400, 'INVALID_QUERY', 'Supply 1-100 unique media IDs.');
    return ids.map(id => this.media(id));
  }
  async editTags(ids: string[], tags: string[], operation: 0 | 1, ownerId: string): Promise<CloudMedia[]> {
    this.owner(ownerId);
    if (!tags.length || tags.length > 32 || tags.some(tag => !tag || tag.length > 80 || tag !== tag.trim().toLowerCase().replace(/\s+/g, ' ') || /[\x00-\x1f]/.test(tag)) || ![0, 1].includes(operation)) throw new ApiError(400, 'INVALID_QUERY', 'Supply normalized tags and an add/remove operation.');
    const refs = this.ids(ids);
    return this.db.runTransaction(async tx => {
      const items = (await tx.getAll(...refs)).map(s => s.data() as CloudMedia | undefined);
      if (items.some(item => !item || !visible(item) || item.ownerId !== ownerId)) throw missing();
      return items.map((value, index) => {
        const item = value!;
        const next = json(item);
        next.revision++;
        next.manualTags = operation === 1 ? [...new Set([...item.manualTags, ...tags])] : item.manualTags.filter(tag => !tags.includes(tag));
        if (operation === 0) for (const tag of tags) delete next.species[tag];
        tx.set(refs[index]!, next);
        this.outbox(tx, next, 'update');
        return next;
      });
    });
  }
  /** Hide the entire authorized batch atomically. Storage cleanup is a separate idempotent step. */
  async beginDelete(ids: string[], ownerId: string): Promise<CloudMedia[]> {
    this.owner(ownerId);
    const refs = this.ids(ids);
    return this.db.runTransaction(async tx => {
      const items = (await tx.getAll(...refs)).map(s => s.data() as CloudMedia | undefined);
      if (items.some(item => !item || item.ownerId !== ownerId || item.phase === 'deleted')) throw missing();
      return items.map((item, index) => {
        const next: CloudMedia = { ...item!, phase: 'deleting', revision: item!.phase === 'deleting' ? item!.revision : item!.revision + 1 };
        delete next.lease;
        tx.set(refs[index]!, next);
        return next;
      });
    });
  }
  /** Call only after ALL versions below this media's immutable source/thumbnail prefixes were removed. */
  async finishDelete(id: string): Promise<boolean> {
    return this.db.runTransaction(async tx => {
      const ref = this.media(id);
      const item = (await tx.get(ref)).data() as CloudMedia | undefined;
      if (!item || item.phase === 'deleted') return false;
      if (item.phase !== 'deleting') throw conflict('Media must be tombstoned before storage cleanup.');
      const reservation = this.reservation(item.ownerId, item.checksum);
      const pointer = await tx.get(reservation);
      tx.set(ref, { ...item, phase: 'deleted', revision: item.revision + 1 });
      if (pointer.exists && pointer.get('mediaId') === id) tx.delete(reservation);
      return true;
    });
  }
  /** Fetch all pages, then apply complete AND/count predicates; never silently truncate search matches. */
  async search(ownerId: string, tags: Record<string, number>, window?: { since: string; until: string }): Promise<CloudMedia[]> {
    this.owner(ownerId);
    const publicQuery = this.collection('media').where('visibility', '==', 'public');
    const queries = window ? [publicQuery] : [this.collection('media').where('ownerId', '==', ownerId), publicQuery];
    const found = new Map<string, CloudMedia>();
    for (const query of queries) {
      let cursor: string | undefined;
      do {
        const ordered = query.orderBy(FieldPath.documentId()).limit(100);
        const page = await (cursor ? ordered.startAfter(cursor) : ordered).get();
        for (const snapshot of page.docs) {
          const item = snapshot.data() as CloudMedia;
          if (visible(item) && (item.ownerId === ownerId || publiclyReadable(item)) && (!window || item.createdAt >= window.since && item.createdAt <= window.until) && matches(item, tags)) found.set(item.id, item);
        }
        cursor = page.size === 100 ? page.docs.at(-1)!.id : undefined;
      } while (cursor);
    }
    return [...found.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
}
