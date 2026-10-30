import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.js';

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const length = request.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    request.resume();
    throw new ApiError(413, 'FILE_TOO_LARGE', `Request exceeds ${limit} bytes.`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) exceeded = true;
    if (!exceeded) chunks.push(Buffer.from(chunk));
  }
  if (exceeded) throw new ApiError(413, 'FILE_TOO_LARGE', `Request exceeds ${limit} bytes.`);
  return Buffer.concat(chunks);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  }
  const bytes = await readBody(request, 64 * 1024);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Body must be valid JSON.'); }
}
