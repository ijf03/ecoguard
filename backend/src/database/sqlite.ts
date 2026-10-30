import { DatabaseSync } from 'node:sqlite';
import type { Media, MediaRepository } from '../media/contracts.js';

// Development-only adapter. Application services never depend on SQLite.
export class SqliteRepository implements MediaRepository {
  private readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        document TEXT NOT NULL
      );
    `);
  }
  async list(): Promise<Media[]> {
    return this.db.prepare('SELECT document FROM media ORDER BY created_at DESC, id').all()
      .map(row => JSON.parse(String(row.document)) as Media);
  }
  async get(id: string): Promise<Media | undefined> {
    const row = this.db.prepare('SELECT document FROM media WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.document)) as Media : undefined;
  }
  async findChecksum(checksum: string): Promise<Media | undefined> {
    const row = this.db.prepare('SELECT document FROM media WHERE checksum = ?').get(checksum);
    return row ? JSON.parse(String(row.document)) as Media : undefined;
  }
  async save(media: Media) {
    this.db.prepare('INSERT INTO media (id, checksum, created_at, document) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document')
      .run(media.id, media.checksum, media.createdAt, JSON.stringify(media));
  }
  async removeMany(ids: string[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.db.prepare('DELETE FROM media WHERE id = ?');
      for (const id of ids) statement.run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async saveMany(items: Media[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of items) await this.save(item);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.db.close(); }
}
