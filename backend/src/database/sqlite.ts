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
        checksum TEXT NOT NULL,
        owner_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        document TEXT NOT NULL,
        UNIQUE(owner_id, checksum)
      );
    `);
    // Preserve existing local metadata while replacing global checksum uniqueness.
    // Unowned legacy records stay unowned rather than being assigned to a new caller.
    const columns = this.db.prepare('PRAGMA table_info(media)').all();
    if (!columns.some(column => column.name === 'owner_id')) {
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE media RENAME TO media_legacy;
        CREATE TABLE media (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(owner_id, checksum));
        INSERT INTO media (id, checksum, owner_id, created_at, document)
          SELECT id, checksum, '', created_at, document FROM media_legacy;
        DROP TABLE media_legacy;
        COMMIT;`);
    }
  }
  async list(): Promise<Media[]> {
    return this.db.prepare('SELECT document FROM media ORDER BY created_at DESC, id').all()
      .map(row => JSON.parse(String(row.document)) as Media);
  }
  async get(id: string): Promise<Media | undefined> {
    const row = this.db.prepare('SELECT document FROM media WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.document)) as Media : undefined;
  }
  async findChecksum(checksum: string, ownerId?: string): Promise<Media | undefined> {
    const row = this.db.prepare('SELECT document FROM media WHERE checksum = ? AND owner_id = ?').get(checksum, ownerId ?? '');
    return row ? JSON.parse(String(row.document)) as Media : undefined;
  }
  async save(media: Media) {
    const result = this.db.prepare(`INSERT INTO media (id, checksum, owner_id, created_at, document) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET document = excluded.document
      WHERE media.owner_id = excluded.owner_id AND media.checksum = excluded.checksum`)
      .run(media.id, media.checksum, media.ownerId ?? '', media.createdAt, JSON.stringify(media));
    if (Number(result.changes) !== 1) throw new Error('Media owner and checksum are immutable.');
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
