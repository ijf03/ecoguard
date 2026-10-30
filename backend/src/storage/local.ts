import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, rename, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Storage } from '../media/contracts.js';

export class LocalStorage implements Storage {
  constructor(private readonly directory: string) {}
  private path(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key.');
    return join(this.directory, key);
  }
  async recover(activeKeys: Set<string>) {
    const trash = join(this.directory, '.trash');
    await mkdir(trash, { recursive: true });
    for (const entry of await readdir(trash, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) throw new Error('Invalid deletion journal.');
      const batch = join(trash, entry.name);
      for (const key of await readdir(batch)) {
        const original = this.path(key);
        if (activeKeys.has(key)) await rename(join(batch, key), original);
        else await unlink(join(batch, key));
      }
      await rm(batch, { recursive: true });
    }
  }
  async stageDelete(keys: string[]) {
    const batch = join(this.directory, '.trash', randomUUID());
    for (const key of keys) this.path(key);
    await mkdir(batch, { recursive: true });
    const moved: string[] = [];
    const rollback = async () => {
      for (const key of moved) await rename(join(batch, key), this.path(key));
      await rm(batch, { recursive: true, force: true });
    };
    try {
      for (const key of [...new Set(keys)]) {
        try { await rename(this.path(key), join(batch, key)); moved.push(key); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    } catch (error) { await rollback(); throw error; }
    return { rollback, commit: () => rm(batch, { recursive: true, force: true }) };
  }
  async put(key: string, bytes: Buffer) {
    const path = this.path(key);
    await mkdir(this.directory, { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  }
  get(key: string) { return readFile(this.path(key)); }
  async remove(key: string) {
    try { await unlink(this.path(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
