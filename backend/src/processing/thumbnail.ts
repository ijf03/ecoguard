import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../http/errors.js';

export interface Thumbnail {
  bytes: Buffer; width: number; height: number; originalWidth: number; originalHeight: number;
}
export interface Thumbnailer { create(bytes: Buffer): Promise<Thumbnail> }
export class PythonThumbnailer implements Thumbnailer {
  constructor(private readonly executable: string) {}
  create(bytes: Buffer): Promise<Thumbnail> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [fileURLToPath(new URL('../../workers/thumbnail.py', import.meta.url))],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let total = 0;
      const timer = setTimeout(() => { child.kill(); reject(new ApiError(503, 'PROCESSING_TIMEOUT', 'Image processing timed out.')); }, 30000);
      child.on('error', () => { clearTimeout(timer); reject(new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Configure ECOGUARD_PYTHON with a Python environment containing Pillow.')); });
      child.stdin.on('error', () => {}); // A failed worker may close stdin early.
      child.stderr.resume(); // Never expose local paths or raw worker exceptions to clients.
      child.stdout.on('data', chunk => {
        total += chunk.length;
        if (total > 2 * 1024 * 1024) child.kill();
        else chunks.push(Buffer.from(chunk));
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 2) return reject(new ApiError(422, 'INVALID_IMAGE', 'Image could not be decoded safely.'));
        if (code !== 0) return reject(new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Image processor is unavailable.'));
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (![result.width, result.height, result.originalWidth, result.originalHeight].every(v => Number.isInteger(v) && v > 0)) throw new Error();
          resolve({ ...result, bytes: Buffer.from(result.bytes, 'base64') });
        } catch { reject(new ApiError(503, 'PROCESSING_FAILED', 'Image processor returned an invalid result.')); }
      });
      child.stdin.end(bytes);
    });
  }
}
