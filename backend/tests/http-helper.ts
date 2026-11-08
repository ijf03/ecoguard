import { request, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';

// Named pipes exercise real HTTP while avoiding sandbox-blocked TCP loopback.
export async function serve(t: TestContext, app: Server) {
  const socketPath = process.platform === 'win32'
    ? String.raw`\\.\pipe\ecoguard-${randomUUID()}`
    : join(tmpdir(), `ecoguard-${randomUUID()}.sock`);
  app.listen(socketPath);
  await once(app, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => app.close(e => e ? reject(e) : resolve())));
  return (path: string, method = 'GET', body?: Buffer, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: Record<string, unknown>; bytes: Buffer; json: any }>((resolve, reject) => {
      const req = request({ socketPath, path, method, headers: { ...headers, ...(body ? { 'Content-Length': String(body.length) } : {}) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('error', reject);
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          resolve({ status: res.statusCode!, headers: res.headers, bytes,
            json: method !== 'HEAD' && res.headers['content-type']?.includes('application/json') ? JSON.parse(bytes.toString()) : undefined });
        });
      });
      req.on('error', reject);
      req.end(body);
    });
}
