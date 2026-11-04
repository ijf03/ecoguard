import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FFmpegVideoProcessor, sampleTimes, validateVideo } from '../src/processing/video.js';
import { command } from '../src/processing/command.js';
import { MediaService } from '../src/media/service.js';
import { SqliteRepository } from '../src/database/sqlite.js';
import { LocalStorage } from '../src/storage/local.js';
import { createApp } from '../src/app.js';
import { serve } from './http-helper.js';
const video = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432', 'hex');
const model = { identity: 'mock', version: '1', weightsSha256: 'a'.repeat(64), confidence: 0.25 };

test('mock FFmpeg: exact sampling, max aggregation, invalid metadata and cleanup on success/failure/timeout', async t => {
  assert.deepEqual(sampleTimes(20), [0, 10]);
  assert.deepEqual(sampleTimes(20.01), [0, 10, 20]);
  assert.equal(sampleTimes(120).length, 12);
  for (const duration of [0, -1, NaN, Infinity, 121]) assert.throws(() => sampleTimes(duration));
  assert.throws(() => validateVideo(video, 'video/webm'));
  assert.throws(() => validateVideo(Buffer.alloc(30), 'video/mp4'));
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-video-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fail = false, timeout = false, codec = 'h264';
  const timestamps: string[] = [];
  const run: typeof command = async (_exe, args, options) => {
    if (args.includes('-show_format')) return Buffer.from(JSON.stringify({ format: { duration: '21', format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', codec_name: codec, width: 640, height: 480 }] }));
    timestamps.push(args[args.indexOf('-ss') + 1]!);
    if (fail) throw Error('mock decode failure');
    if (timeout) return command(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { ...(options?.signal ? { signal: options.signal } : {}), timeout: 20 });
    return Buffer.from('mock-frame');
  };
  let frame = 0;
  const detector = { detect: async () => ({ model, species: [{ cat: 2 }, { cat: 1, dog: 1 }, { cat: 3 }][frame++ % 3]! }) };
  const processor = new FFmpegVideoProcessor('mock', 'mock', { run, tempRoot: root });
  const result = await processor.process(video, detector);
  assert.deepEqual(timestamps, ['0', '10', '20']);
  assert.deepEqual(result.species, { cat: 3, dog: 1 });
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(processor.process(video, { detect: async () => { throw Error('mock inference failure'); } }));
  assert.deepEqual(await readdir(root), []);
  const empty = await processor.process(video, { detect: async () => ({ model, species: {} }) });
  assert.deepEqual(empty.species, {});
  assert.deepEqual(await readdir(root), []);
  fail = true; await assert.rejects(processor.process(video, detector));
  assert.deepEqual(await readdir(root), []);
  fail = false; timeout = true; await assert.rejects(processor.process(video, detector), /timed out/);
  assert.deepEqual(await readdir(root), []);
  timeout = false; codec = 'hevc'; await assert.rejects(processor.process(video, detector), /H.264/);
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(new FFmpegVideoProcessor('missing-ecoguard-executable', 'missing-ecoguard-executable', { tempRoot: root }).process(video, detector));
  assert.deepEqual(await readdir(root), []);
});

test('mock video workflow: persistence, dedup, serialized processing, failure/retry, search, ranges and deletion', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-ecoguard-video-'));
  let repo = new SqliteRepository(join(root, 'metadata.sqlite'));
  t.after(async () => { repo.close(); await rm(root, { recursive: true, force: true }); });
  const storage = new LocalStorage(join(root, 'originals'));
  let broken = true, calls = 0, active = 0, peak = 0;
  const processor = { process: async () => {
    active++; peak = Math.max(peak, active); calls++;
    try { await new Promise(resolve => setTimeout(resolve, 5)); if (broken) throw Error('private local exception'); return { duration: 11, sampledAt: [0, 10], species: { cat: 2 }, model }; }
    finally { active--; }
  } };
  const detector = { detect: async () => ({ species: {}, model }) };
  let service = new MediaService(repo, storage, undefined, detector, undefined, processor);
  const result = await service.upload(video, 'video/mp4', 'cats.mp4', 'public');
  assert.equal(result.media.processingStatus, 'failed');
  assert.deepEqual((await service.file(result.media.id)).bytes, video);
  assert.equal((await service.upload(video, 'video/mp4', 'duplicate.mp4')).duplicate, true);
  assert.equal(calls, 1);
  await service.editTags([result.media.id], ['collar'], 1);
  broken = false;
  await Promise.all([service.process(result.media.id), service.process(result.media.id)]);
  assert.equal(peak, 1);
  repo.close(); repo = new SqliteRepository(join(root, 'metadata.sqlite'));
  service = new MediaService(repo, storage, undefined, detector, undefined, processor);
  const persisted = await service.get(result.media.id);
  assert.equal(persisted.processingStatus, 'complete');
  assert.equal(persisted.mediaType, 'video'); assert.equal(persisted.duration, 11);
  assert.deepEqual(persisted.sampledAt, [0, 10]); assert.deepEqual(persisted.detectionModel, model);
  assert.deepEqual(persisted.manualTags, ['collar']);
  assert.equal((await service.search({ cat: 2 })).length, 1);
  const call = await serve(t, createApp({ media: service, maxVideoUploadBytes: 30 }));
  const path = `/api/media/${persisted.id}/file`;
  for (const [range, start, end] of [['bytes=0-3', 0, 3], ['bytes=4-', 4, video.length - 1], ['bytes=-4', video.length - 4, video.length - 1], ['bytes=0-999', 0, video.length - 1]] as const) {
    const response = await call(path, 'GET', undefined, { Range: range });
    assert.equal(response.status, 206); assert.deepEqual(response.bytes, video.subarray(start, end + 1));
    assert.equal(response.headers['content-range'], `bytes ${start}-${end}/${video.length}`);
  }
  for (const range of ['bytes=999-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,3-4', 'bad']) assert.equal((await call(path, 'GET', undefined, { Range: range })).status, 416);
  assert.equal((await call(path, 'HEAD')).bytes.length, 0);
  assert.equal((await call(path)).headers['content-type'], 'video/mp4');
  assert.equal((await call('/api/media', 'POST', Buffer.alloc(31), { 'Content-Type': 'video/mp4' })).status, 413);
  assert.equal((await call('/api/media', 'POST', video, { 'Content-Type': 'video/webm' })).status, 415);
  assert.equal((await call('/api/media/00000000-0000-0000-0000-000000000000/file', 'GET', undefined, { Range: 'bytes=0-1' })).status, 404);
  assert.equal((await call('/api/media/delete', 'POST', Buffer.from(JSON.stringify({ urls: [path] })), { 'Content-Type': 'application/json' })).status, 200);
  assert.deepEqual(await repo.list(), []);
  await assert.rejects(storage.get(persisted.storageKey));
});
