import type { Thumbnailer } from '../processing/thumbnail.js';
import type { ImageValidator } from '../processing/image-validator.js';
import { validateVideo, type VideoProcessor } from '../processing/video.js';
import { validateDetection, type Detector } from '../processing/detector.js';
import { createHash, randomUUID } from 'node:crypto';
import { matches } from './search.js';
import { ApiError } from '../http/errors.js';
import type { ImageType, Media, MediaRepository, Storage } from './contracts.js';

export function validateImage(bytes: Buffer, declared: string): ImageType {
  let type: ImageType | undefined;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0) type = 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 &&
      bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) type = 'image/jpeg';
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) type = 'image/webp';
  if (!type || type !== declared) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Supply JPEG, PNG or WebP bytes with a matching Content-Type.');
  return type;
}

export class MediaService {
  // Serialize mutations for deterministic local checksum deduplication.
  // A cloud adapter must enforce unique checksum writes across Lambda instances.
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly repository: MediaRepository, private readonly storage: Storage, private readonly thumbnailer?: Thumbnailer, private readonly detector?: Detector, private readonly imageValidator?: ImageValidator, private readonly videoProcessor?: VideoProcessor) {}
  searchImage(bytes: Buffer, declared: string, lostPet?: { since: string; until: string; tags: string[] }) {
    const work = this.pending.then(async () => {
      if (bytes.length > 10 * 1024 * 1024) throw new ApiError(413, 'FILE_TOO_LARGE', 'Image exceeds 10 MiB.');
      validateImage(bytes, declared);
      if (!this.detector || !this.imageValidator) throw new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Configure Python, Pillow and the detector.');
      await this.imageValidator.validate(bytes);
      const result = validateDetection(await this.detector.detect(bytes));
      if (!Object.keys(result.species).length) return [];
      const items = await this.search(result.species, lostPet?.since, lostPet?.until);
      return lostPet ? items.filter(item => lostPet.tags.every(tag => item.manualTags.includes(tag))) : items;
    });
    this.pending = work.catch(() => undefined);
    return work;
  }
  upload(bytes: Buffer, contentType: string, filename: string, visibility: 'private' | 'public' = 'private') {
    const work = this.pending.then(() => this.uploadOne(bytes, contentType, filename, visibility));
    this.pending = work.catch(() => undefined);
    return work;
  }
  private async uploadOne(bytes: Buffer, declared: string, filename: string, visibility: 'private' | 'public') {
    const isVideo = declared.startsWith('video/');
    const contentType = isVideo ? validateVideo(bytes, declared) : validateImage(bytes, declared);
    if (!filename.trim() || filename.length > 255 || /[\x00-\x1f\\/]/.test(filename)) {
      throw new ApiError(400, 'INVALID_FILENAME', 'Filename must be 1-255 characters without paths or control characters.');
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.repository.findChecksum(checksum);
    if (existing) return { media: existing, duplicate: true };
    const id = randomUUID();
    const media: Media = { id, filename, checksum, storageKey: id, contentType, size: bytes.length,
      createdAt: new Date().toISOString(), visibility, processingStatus: 'pending', species: {}, manualTags: [], mediaType: isVideo ? 'video' : 'image' };
    // Images decode before storage; video originals remain retryable if probing fails.
    const thumbnail = !isVideo && this.thumbnailer ? await this.thumbnailer.create(bytes) : undefined;
    // The local composition supplies a validator even when thumbnails are unconfigured.
    // Missing Python must not silently downgrade upload validation to magic bytes.
    if (!isVideo && !this.thumbnailer && this.imageValidator) await this.imageValidator.validate(bytes);
    if (thumbnail) {
      media.thumbnailKey = randomUUID();
      media.width = thumbnail.originalWidth;
      media.height = thumbnail.originalHeight;
      media.thumbnailWidth = thumbnail.width;
      media.thumbnailHeight = thumbnail.height;
    }
    await this.storage.put(id, bytes);
    if (thumbnail && media.thumbnailKey) {
      try { await this.storage.put(media.thumbnailKey, thumbnail.bytes); }
      catch (error) { await this.storage.remove(id); if (media.thumbnailKey) await this.storage.remove(media.thumbnailKey); throw error; }
    }
    try { await this.repository.save(media); }
    catch (error) { await this.storage.remove(id); if (media.thumbnailKey) await this.storage.remove(media.thumbnailKey); throw error; }
    return { media: this.detector ? await this.processOne(id) : media, duplicate: false };
  }
  process(id: string) {
    const work = this.pending.then(() => this.processOne(id));
    this.pending = work.catch(() => undefined);
    return work;
  }
  private async processOne(id: string): Promise<Media> {
    const media = await this.get(id);
    // Clear stale inferred results before an attempt, retaining manual annotations.
    media.processingStatus = 'pending';
    media.species = {};
    delete media.detectionModel;
    delete media.processingError;
    delete media.duration;
    delete media.sampledAt;
    await this.repository.save(media);
    try {
      if (!this.detector) throw new Error('Detector not configured');
      const bytes = await this.storage.get(media.storageKey);
      if (media.contentType === 'video/mp4') {
        if (!this.videoProcessor) throw new Error('Video processor not configured');
        const result = await this.videoProcessor.process(bytes, this.detector);
        validateDetection(result);
        const completed: Media = { ...media, duration: result.duration, sampledAt: result.sampledAt, species: result.species, detectionModel: result.model, processingStatus: 'complete' };
        await this.repository.save(completed);
        return completed;
      }
      if (!media.thumbnailKey) {
        if (!this.thumbnailer) throw new Error('Thumbnail processor not configured');
        const thumbnail = await this.thumbnailer.create(bytes);
        const key = randomUUID();
        try { await this.storage.put(key, thumbnail.bytes); }
        catch (error) { await this.storage.remove(key); throw error; }
        media.thumbnailKey = key;
        media.width = thumbnail.originalWidth;
        media.height = thumbnail.originalHeight;
        media.thumbnailWidth = thumbnail.width;
        media.thumbnailHeight = thumbnail.height;
        try { await this.repository.save(media); }
        catch (error) { await this.storage.remove(key); delete media.thumbnailKey; throw error; }
      }
      const result = validateDetection(await this.detector.detect(bytes));
      const completed: Media = { ...media, species: result.species, detectionModel: result.model, processingStatus: 'complete' };
      await this.repository.save(completed);
      return completed;
    } catch (error) {
      media.processingStatus = 'failed';
      media.processingError = error instanceof ApiError ? `${error.code}: ${error.message}` :
        'PROCESSING_FAILED: Check input validity, duration/codec limits, FFmpeg/ffprobe, Python, Pillow, Ultralytics, model path and confidence; see docs/DETECTION.md. Retry processing after setup.';
      // A failed completion write must never leave an in-memory complete response.
      await this.repository.save(media);
      return media;
    }
  }
  deleteMany(ids: string[]) {
    const work = this.pending.then(async () => {
      const items = await Promise.all(ids.map(id => this.get(id)));
      if (!this.storage.stageDelete) throw new ApiError(503, 'DELETE_UNAVAILABLE', 'Storage does not support coordinated deletion.');
      const staged = await this.storage.stageDelete(items.flatMap(item => [item.storageKey, ...(item.thumbnailKey ? [item.thumbnailKey] : [])]));
      try { await this.repository.removeMany(ids); }
      catch (error) { await staged.rollback(); throw error; }
      // After DB commit a failed cleanup is safely finished by startup recovery.
      try { await staged.commit(); return { deleted: ids.length, cleanupPending: false }; }
      catch { return { deleted: ids.length, cleanupPending: true }; }
    });
    this.pending = work.catch(() => undefined);
    return work;
  }
  editTags(ids: string[], tags: string[], operation: number) {
    const work = this.pending.then(async () => {
      // Resolve the whole batch before modifying anything.
      const items = await Promise.all(ids.map(id => this.get(id)));
      for (const item of items) {
        if (operation === 1) item.manualTags = [...new Set([...item.manualTags, ...tags])];
        else {
          item.manualTags = item.manualTags.filter(tag => !tags.includes(tag));
          for (const tag of tags) delete item.species[tag];
        }
      }
      await this.repository.saveMany(items);
      return items;
    });
    this.pending = work.catch(() => undefined);
    return work;
  }
  async search(tags: Record<string, number>, publicSince?: string, publicUntil?: string) {
    return (await this.repository.list()).filter(item =>
      (!publicSince || (item.visibility === 'public' && item.createdAt >= publicSince && (!publicUntil || item.createdAt <= publicUntil))) && matches(item, tags));
  }
  list() { return this.repository.list(); }
  async get(id: string) {
    const media = await this.repository.get(id);
    if (!media) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media not found.');
    return media;
  }
  async thumbnail(id: string) {
    const media = await this.get(id);
    if (!media.thumbnailKey) throw new ApiError(404, 'THUMBNAIL_NOT_FOUND', 'Thumbnail is not available.');
    return this.storage.get(media.thumbnailKey);
  }
  async fromThumbnail(url: string) {
    const match = /^\/api\/media\/([a-f0-9-]{36})\/thumbnail$/.exec(url);
    if (!match) throw new ApiError(400, 'INVALID_QUERY', 'Use a thumbnailUrl returned by this API.');
    const media = await this.get(match[1]!);
    if (!media.thumbnailKey) throw new ApiError(404, 'THUMBNAIL_NOT_FOUND', 'Thumbnail is not available.');
    return media;
  }
  async file(id: string) {
    const media = await this.get(id);
    return { media, bytes: await this.storage.get(media.storageKey) };
  }
}
