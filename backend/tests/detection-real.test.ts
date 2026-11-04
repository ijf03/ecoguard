import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PythonDetector } from '../src/processing/detector.js';
import { PythonThumbnailer } from '../src/processing/thumbnail.js';
import { SqliteRepository } from '../src/database/sqlite.js';
import { LocalStorage } from '../src/storage/local.js';
import { MediaService } from '../src/media/service.js';
import { PythonImageValidator } from '../src/processing/image-validator.js';

// Explicit opt-in: no downloads and no mocked detections in this test.
test('real YOLO/Pillow: animal counts, negative control, persisted upload and search', {
  skip: !process.env.TEST_PYTHON || !process.env.TEST_MODEL_PATH || !process.env.TEST_IMAGE_DIR,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-real-'));
  const repo = new SqliteRepository(join(root, 'db.sqlite'));
  t.after(async () => { repo.close(); await rm(root, { recursive: true, force: true }); });
  const service = new MediaService(repo, new LocalStorage(join(root, 'files')),
    new PythonThumbnailer(process.env.TEST_PYTHON!), new PythonDetector(process.env.TEST_PYTHON!, process.env.TEST_MODEL_PATH!), new PythonImageValidator(process.env.TEST_PYTHON!));
  for (const [filename, species, minimum] of [['cats.jpg', 'cat', 2], ['dog.jpg', 'dog', 1], ['bus.jpg', '', 0]] as const) {
    const result = await service.upload(await readFile(join(process.env.TEST_IMAGE_DIR!, filename)), 'image/jpeg', filename);
    assert.equal(result.media.processingStatus, 'complete', result.media.processingError ?? 'Expected successful real inference');
    assert.ok(result.media.thumbnailKey);
    assert.deepEqual((await repo.get(result.media.id))!.detectionModel, result.media.detectionModel);
    if (species) {
      assert.ok(result.media.species[species]! >= minimum);
      assert.ok((await service.search({ [species]: minimum })).some(media => media.id === result.media.id));
    } else assert.deepEqual(result.media.species, {});
    t.diagnostic(`${filename}: ${JSON.stringify(result.media.species)}; ${JSON.stringify(result.media.detectionModel)}`);
  }
  const before = await repo.list();
  assert.equal((await service.searchImage(await readFile(join(process.env.TEST_IMAGE_DIR!, 'cats.jpg')), 'image/jpeg')).length, 1);
  assert.deepEqual(await service.searchImage(await readFile(join(process.env.TEST_IMAGE_DIR!, 'bus.jpg')), 'image/jpeg'), []);
  await assert.rejects(service.searchImage(Buffer.from('89504e470d0a1a0a00000000494844520000000100000001', 'hex'), 'image/png'));
  assert.deepEqual(await repo.list(), before);
  const cats = before.find(item => item.filename === 'cats.jpg')!;
  await service.editTags([cats.id], ['collar'], 1);
  const lostFilter = { since: new Date(Date.now() - 86400000).toISOString(), until: new Date().toISOString(), tags: ['collar'] };
  assert.equal((await service.searchImage(await readFile(join(process.env.TEST_IMAGE_DIR!, 'cats.jpg')), 'image/jpeg', lostFilter)).length, 0); // All uploads above were private.
  const publicCats = await repo.get(cats.id); publicCats!.visibility = 'public'; await repo.save(publicCats!);
  assert.equal((await service.searchImage(await readFile(join(process.env.TEST_IMAGE_DIR!, 'cats.jpg')), 'image/jpeg', lostFilter)).length, 1);
});
