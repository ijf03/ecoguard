import type { Thumbnailer } from '../processing/thumbnail.js';
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
  constructor(private readonly repository: MediaRepository, private readonly storage: Storage, private readonly thumbnailer?: Thumbnailer) {}
  upload(bytes: Buffer, contentType: string, filename: string, visibility: 'private' | 'public' = 'private') {
    const work = this.pending.then(() => this.uploadOne(bytes, contentType, filename, visibility));
    this.pending = work.catch(() => undefined);
    return work;
  }
  private async uploadOne(bytes: Buffer, declared: string, filename: string, visibility: 'private' | 'public') {
    const contentType = validateImage(bytes, declared);
    if (!filename.trim() || filename.length > 255 || /[\x00-\x1f\\/]/.test(filename)) {
      throw new ApiError(400, 'INVALID_FILENAME', 'Filename must be 1-255 characters without paths or control characters.');
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.repository.findChecksum(checksum);
    if (existing) return { media: existing, duplicate: true };
    const id = randomUUID();
    const media: Media = { id, filename, checksum, storageKey: id, contentType, size: bytes.length,
      createdAt: new Date().toISOString(), visibility, processingStatus: 'pending', species: {}, manualTags: [] };
    // Decode before writing anything. ML status stays pending until a real detector runs.
    const thumbnail = this.thumbnailer ? await this.thumbnailer.create(bytes) : undefined;
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
    return { media, duplicate: false };
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
  async search(tags: Record<string, number>, publicSince?: string) {
    return (await this.repository.list()).filter(item =>
      (!publicSince || (item.visibility === 'public' && item.createdAt >= publicSince)) && matches(item, tags));
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
