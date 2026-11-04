import { PythonThumbnailer } from './processing/thumbnail.js';
import { PythonDetector } from './processing/detector.js';
import { PythonImageValidator, type ImageValidator } from './processing/image-validator.js';
import { FFmpegVideoProcessor } from './processing/video.js';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteRepository } from './database/sqlite.js';
import { LocalStorage } from './storage/local.js';
import { MediaService } from './media/service.js';

export async function createLocalServices(directory: string, options: { imageValidator?: ImageValidator; python?: string } = {}) {
  const python = options.python ?? process.env.ECOGUARD_PYTHON ?? '';
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const repository = new SqliteRepository(resolve(root, 'metadata.sqlite'));
  const storage = new LocalStorage(resolve(root, 'originals'));
  try {
    const records = await repository.list();
    await storage.recover(new Set(records.flatMap(item => [item.storageKey, ...(item.thumbnailKey ? [item.thumbnailKey] : [])])));
  } catch (error) { repository.close(); throw error; }
  return { media: new MediaService(repository, storage,
    python ? new PythonThumbnailer(python) : undefined,
    new PythonDetector(python, process.env.ECOGUARD_MODEL_PATH ?? '', process.env.ECOGUARD_CONFIDENCE ?? '0.25'),
    options.imageValidator ?? new PythonImageValidator(python),
    new FFmpegVideoProcessor(process.env.ECOGUARD_FFMPEG ?? 'ffmpeg', process.env.ECOGUARD_FFPROBE ?? 'ffprobe')),
    close: () => repository.close() };
}
