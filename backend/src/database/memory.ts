import type { Media, MediaRepository } from '../media/contracts.js';

export class MemoryRepository implements MediaRepository {
  private readonly records = new Map<string, Media>();
  async list() { return structuredClone([...this.records.values()]); }
  async get(id: string) { return structuredClone(this.records.get(id)); }
  async findChecksum(checksum: string, ownerId?: string) { return (await this.list()).find(item => item.checksum === checksum && item.ownerId === ownerId); }
  async removeMany(ids: string[]) { for (const id of ids) this.records.delete(id); }
  async saveMany(items: Media[]) { for (const media of items) this.records.set(media.id, structuredClone(media)); }
  async save(media: Media) { this.records.set(media.id, structuredClone(media)); }
}
