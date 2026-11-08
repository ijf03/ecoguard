import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const stage = await mkdtemp(join(tmpdir(), 'ecoguard-lambda-'));
const archive = resolve(root, '.build/ecoguard-runtime.zip');
try {
  await mkdir(resolve(root, '.build'), { recursive: true });
  await Promise.all(['package.json', 'package-lock.json', 'dist', 'config'].map(name => cp(resolve(root, name), join(stage, name), { recursive: true })));
  // Use the npm running this script so overrides/lockfile semantics remain consistent.
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this packager through npm run package:lambda using npm 9+.');
  const { stdout: version } = await exec(process.execPath, [npm, '--version']);
  if (Number(version.split('.')[0]) < 9) throw new Error('Use npm 9+ to honor the security override. npm 11 is verified.');
  await exec(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, env: process.env, maxBuffer: 1024 * 1024 });
  await rm(archive, { force: true });
  await exec('zip', ['-q', '-r', archive, '.'], { cwd: stage, maxBuffer: 1024 * 1024 });
  console.log(archive);
} finally { await rm(stage, { recursive: true, force: true }); }
