import { spawn } from 'node:child_process';
import { ApiError } from '../http/errors.js';

/** Bounded, shell-free subprocess. Resolve/reject only after close so callers can clean files. */
export function command(executable: string, args: string[], options: { input?: Buffer; signal?: AbortSignal; timeout?: number; maxBytes?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!executable.trim()) return reject(new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Configure processing executables and dependencies; see docs/DETECTION.md.'));
    if (options.signal?.aborted) return reject(new ApiError(503, 'PROCESSING_TIMEOUT', 'Processing timed out.'));
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let failure: Error | undefined;
    let size = 0;
    const chunks: Buffer[] = [];
    const abort = () => { failure = new ApiError(503, 'PROCESSING_TIMEOUT', 'Processing timed out.'); child.kill(); };
    const timer = setTimeout(abort, options.timeout ?? 30000);
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => { failure = new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Configure processing executables and dependencies; see docs/DETECTION.md.'); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > (options.maxBytes ?? 65536)) { failure = new ApiError(503, 'PROCESSING_FAILED', 'Processor output exceeded its limit.'); child.kill(); }
      else chunks.push(Buffer.from(chunk));
    });
    child.on('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code === 2) reject(new ApiError(422, 'INVALID_IMAGE', 'Image could not be decoded safely.'));
      else if (code !== 0) reject(new ApiError(503, 'PROCESSING_FAILED', 'Processing failed; check local dependencies and input.'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(options.input);
  });
}
