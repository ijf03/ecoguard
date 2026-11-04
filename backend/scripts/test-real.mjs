import { existsSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Explicit verification mode: do not turn missing real dependencies into skipped tests.
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.TEST_PYTHON && process.env.ECOGUARD_PYTHON) process.env.TEST_PYTHON = process.env.ECOGUARD_PYTHON;
if (!process.env.TEST_MODEL_PATH && process.env.ECOGUARD_MODEL_PATH) process.env.TEST_MODEL_PATH = process.env.ECOGUARD_MODEL_PATH;
process.env.TEST_IMAGE_DIR ??= resolve('data/inference-samples');
process.env.TEST_FFMPEG ??= process.env.ECOGUARD_FFMPEG || 'ffmpeg';
process.env.TEST_FFPROBE ??= process.env.ECOGUARD_FFPROBE || 'ffprobe';
const errors = [];
if (!process.env.TEST_PYTHON || process.env.TEST_PYTHON === 'undefined') errors.push('Set TEST_PYTHON or ECOGUARD_PYTHON to a Python executable.');
if (!process.env.TEST_MODEL_PATH || process.env.TEST_MODEL_PATH === 'undefined' || !existsSync(process.env.TEST_MODEL_PATH) || !statSync(process.env.TEST_MODEL_PATH).isFile()) errors.push('Set TEST_MODEL_PATH or ECOGUARD_MODEL_PATH to existing animal detection weights.');
for (const name of ['cats.jpg', 'dog.jpg', 'bus.jpg']) if (!existsSync(resolve(process.env.TEST_IMAGE_DIR, name))) errors.push(`Missing fixture ${name}; see docs/DETECTION.md.`);
const checks = [
  ['Python/Pillow/Ultralytics/torch', process.env.TEST_PYTHON, ['-c', 'import PIL,ultralytics,torch; print("Pillow",PIL.__version__,"Ultralytics",ultralytics.__version__,"torch",torch.__version__)']],
  ['FFmpeg', process.env.TEST_FFMPEG, ['-version']],
  ['ffprobe', process.env.TEST_FFPROBE, ['-version']],
];
for (const [label, executable, args] of checks) {
  if (!executable || executable === 'undefined') continue;
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) errors.push(`${label} is unavailable or failed its dependency check.`);
  else console.log(result.stdout.split(/\r?\n/)[0]);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const tests = readdirSync('tests').filter(name => name.endsWith('.test.ts')).map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', ...tests], { stdio: 'inherit', windowsHide: true, env: process.env });
if (result.error) console.error('Test runner could not start.');
process.exit(result.status ?? 1);
