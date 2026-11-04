import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { command } from '../src/processing/command.js';
import { FFmpegVideoProcessor } from '../src/processing/video.js';
import { PythonDetector } from '../src/processing/detector.js';
import { SqliteRepository } from '../src/database/sqlite.js';
import { LocalStorage } from '../src/storage/local.js';
import { MediaService } from '../src/media/service.js';

test('real FFmpeg/YOLO: generated 11s cat MP4, samples 0/10, max counts, persisted and retryable', {
  skip: !process.env.TEST_PYTHON || !process.env.TEST_MODEL_PATH || !process.env.TEST_IMAGE_DIR || !process.env.TEST_FFMPEG || !process.env.TEST_FFPROBE,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-video-real-'));
  const repo = new SqliteRepository(join(root, 'db.sqlite'));
  t.after(async () => { repo.close(); await rm(root, { recursive: true, force: true }); });
  const fixture = join(root, 'cats.mp4');
  await command(process.env.TEST_FFMPEG!, ['-nostdin', '-v', 'error', '-loop', '1', '-i', join(process.env.TEST_IMAGE_DIR!, 'cats.jpg'), '-t', '11', '-r', '1', '-vf', 'scale=640:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);
  const processor = new FFmpegVideoProcessor(process.env.TEST_FFMPEG!, process.env.TEST_FFPROBE!, { tempRoot: root });
  const detector = new PythonDetector(process.env.TEST_PYTHON!, process.env.TEST_MODEL_PATH!);
  const service = new MediaService(repo, new LocalStorage(join(root, 'files')), undefined, detector, undefined, processor);
  const result = await service.upload(await readFile(fixture), 'video/mp4', 'cats.mp4');
  assert.equal(result.media.processingStatus, 'complete', result.media.processingError ?? 'Expected video inference success');
  assert.deepEqual(result.media.sampledAt, [0, 10]);
  assert.equal(result.media.species.cat, 2);
  assert.equal((await service.search({ cat: 2 })).length, 1);
  assert.ok(!(await readdir(root)).some(name => name.startsWith('ecoguard-video-')));
  const broken = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432', 'hex');
  const invalid = await service.upload(broken, 'video/mp4', 'invalid.mp4');
  assert.equal(invalid.media.processingStatus, 'failed');
  assert.deepEqual((await service.file(invalid.media.id)).bytes, broken);
  assert.ok(!(await readdir(root)).some(name => name.startsWith('ecoguard-video-')));
  t.diagnostic(`Real fixture duration=${result.media.duration}; samples=${result.media.sampledAt}; species=${JSON.stringify(result.media.species)}; model=${JSON.stringify(result.media.detectionModel)}`);
});
