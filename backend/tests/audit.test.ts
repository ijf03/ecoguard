import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalServices } from '../src/local.js';
import { ApiError } from '../src/http/errors.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII=', 'base64');
test('local composition fails closed without decoding dependencies and writes no originals/records', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-decode-audit-'));
  const python = process.env.ECOGUARD_PYTHON;
  delete process.env.ECOGUARD_PYTHON;
  const services = await createLocalServices(root);
  t.after(async () => { services.close(); await rm(root, { recursive: true, force: true }); if (python !== undefined) process.env.ECOGUARD_PYTHON = python; });
  await assert.rejects(services.media.upload(png, 'image/png', 'image.png'), /executable|Configure|file/i);
  assert.deepEqual(await services.media.list(), []);
  assert.deepEqual(await readdir(join(root, 'originals')), ['.trash']);
});

test('upload invokes validation without thumbnail generation and rejects corrupt decode before storage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-corrupt-audit-'));
  const services = await createLocalServices(root, { python: '', imageValidator: { validate: async () => { throw new ApiError(422, 'INVALID_IMAGE', 'Invalid image.'); } } });
  t.after(async () => { services.close(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(services.media.upload(png.subarray(0, 24), 'image/png', 'corrupt.png'), /Invalid image/);
  assert.deepEqual(await services.media.list(), []);
});

test('actual TCP/server-process restart preserves SQLite media, checksum dedup and original bytes (mock decoding)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecoguard-process-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const start = async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import {createLocalServices} from './src/local.ts';
      import {createApp} from './src/app.ts';
      const services=await createLocalServices(process.env.AUDIT_DATA_DIR,{imageValidator:{validate:async()=>{}}});
      const app=createApp(services);
      app.listen(0,'127.0.0.1',()=>process.send({port:app.address().port}));
      process.on('message',()=>app.close(()=>{services.close();process.disconnect();}));
    `], { env: { ...process.env, ECOGUARD_PYTHON: '', AUDIT_DATA_DIR: root }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr!.on('data', chunk => { stderr += chunk.toString(); });
    const message = once(child, 'message');
    const failure = once(child, 'exit').then(() => { throw Error(`Audit server exited before ready: ${stderr}`); });
    const timer = setTimeout(() => child.kill(), 15000);
    let ready: unknown[];
    try { ready = await Promise.race([message, failure]); }
    finally { clearTimeout(timer); }
    const url = `http://127.0.0.1:${(ready[0] as { port: number }).port}`;
    const stop = async () => { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, 'exit'); child.send('stop'); await exited; };
    t.after(stop);
    return { url, stop };
  };
  const first = await start();
  assert.equal((await fetch(first.url + '/api/health')).status, 200);
  const response = await fetch(first.url + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png) });
  assert.equal(response.status, 201);
  const uploaded = await response.json();
  await first.stop();
  const second = await start();
  const detail = await (await fetch(second.url + `/api/media/${uploaded.media.id}`)).json();
  assert.equal(detail.media.checksum, uploaded.media.checksum);
  assert.deepEqual(Buffer.from(await (await fetch(second.url + detail.media.originalUrl)).arrayBuffer()), png);
  const duplicate = await (await fetch(second.url + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png) })).json();
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.media.id, uploaded.media.id);
  await second.stop();
});
