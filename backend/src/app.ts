import { createServer } from 'node:http';
import { handler } from './health.js';
import { ApiError, json, sendError } from './http/errors.js';
import { bulkTags, mediaIds, countQuery, lostPetQuery, lostPetImageQuery, object } from './media/search.js';
import { readBody, readJson } from './http/body.js';
import type { Media } from './media/contracts.js';
import type { MediaService } from './media/service.js';
import { byteRange } from './http/range.js';
import { checkRequestOrigin, clearSessionCookie, sessionCookie, type Authenticator } from './auth.js';

function present(item: Media, ownerId?: string) {
  const { storageKey: _original, thumbnailKey: _thumbnail, ownerId: _owner, ...publicFields } = item;
  return { ...publicFields, canEdit: !ownerId || item.ownerId === ownerId, originalUrl: `/api/media/${item.id}/file`,
    ...(item.thumbnailKey ? { thumbnailUrl: `/api/media/${item.id}/thumbnail` } : {}) };
}
export interface AppOptions { media?: MediaService; maxUploadBytes?: number; maxVideoUploadBytes?: number; auth?: Authenticator }
export function createApp(options: AppOptions = {}) {
  const maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;
  const maxVideoUploadBytes = options.maxVideoUploadBytes ?? 50 * 1024 * 1024;
  if (!Number.isSafeInteger(maxVideoUploadBytes) || maxVideoUploadBytes < 1 || maxVideoUploadBytes > 200 * 1024 * 1024) throw new Error('Video upload limit must be 1 byte to 200 MiB.');
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const requireMethod = (method: string) => {
        if (request.method !== method) {
          response.setHeader('Allow', method);
          throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${method} for this endpoint.`);
        }
      };
      let ownerId: string | undefined;
      if (options.auth) {
        checkRequestOrigin(request, options.auth);
        if (path === '/api/auth/session' && request.method === 'DELETE') {
          response.setHeader('Set-Cookie', clearSessionCookie(options.auth.secureCookie));
          response.setHeader('Cache-Control', 'no-store');
          json(response, 200, { signedOut: true });
          return;
        }
        const token = options.auth.token(request);
        const principal = await options.auth.verify(token);
        ownerId = principal.sub;
        if (path === '/api/auth/session') {
          requireMethod('POST');
          response.setHeader('Set-Cookie', sessionCookie(token, principal.expiresAt, options.auth.secureCookie));
          response.setHeader('Cache-Control', 'no-store');
          json(response, 200, { userId: principal.sub });
          return;
        }
      }
      // Map explicitly: Array.map supplies an index as its second argument.
      const expose = (item: Media) => present(item, ownerId);
      if (path === '/api/health') {
        requireMethod('GET');
        const result = await handler();
        response.writeHead(result.statusCode, result.headers);
        response.end(result.body);
        return;
      }
      if (path === '/api/search/thumbnail' && options.media) {
        requireMethod('POST');
        const body = object(await readJson(request));
        if (typeof body.thumbnailUrl !== 'string') throw new ApiError(400, 'INVALID_QUERY', 'Supply thumbnailUrl.');
        json(response, 200, { media: expose(await options.media.fromThumbnail(body.thumbnailUrl, ownerId)) });
        return;
      }
      if ((path === '/api/search/image' || path === '/api/search/lost-pet/image') && options.media) {
        requireMethod('POST');
        const filter = path.includes('lost-pet') ? lostPetImageQuery({
          tags: url.searchParams.getAll('tag'),
          ...(url.searchParams.has('since') ? { since: url.searchParams.get('since') } : {}),
          ...(url.searchParams.has('until') ? { until: url.searchParams.get('until') } : {}),
        }) : undefined;
        const items = await options.media.searchImage(await readBody(request, maxUploadBytes), request.headers['content-type'] ?? '', filter, ownerId);
        json(response, 200, { media: items.map(expose) });
        return;
      }
      const thumbnail = /^\/api\/media\/([a-f0-9-]{36})\/thumbnail$/.exec(path);
      if (thumbnail && options.media) {
        requireMethod('GET');
        const bytes = await options.media.thumbnail(thumbnail[1]!, ownerId);
        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length,
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        response.end(bytes);
        return;
      }
      if (path === '/api/media/delete' && options.media) {
        requireMethod('POST');
        const body = object(await readJson(request));
        json(response, 200, await options.media.deleteMany(mediaIds(body.urls), ownerId));
        return;
      }
      if (path === '/api/media/tags' && options.media) {
        requireMethod('POST');
        const query = bulkTags(await readJson(request));
        const items = await options.media.editTags(query.ids, query.tags, query.operation, ownerId);
        json(response, 200, { media: items.map(expose) });
        return;
      }
      if ((path === '/api/search' || path === '/api/search/lost-pet') && options.media) {
        requireMethod('POST');
        const body = await readJson(request);
        const query = path.endsWith('lost-pet') ? lostPetQuery(body) : { tags: countQuery(object(body).tags), since: undefined, until: undefined };
        const items = await options.media.search(query.tags, query.since, query.until, ownerId);
        json(response, 200, { media: items.map(expose) });
        return;
      }
      if (path === '/api/media' && options.media) {
        if (request.method === 'GET') {
          const items = await options.media.list(ownerId);
          json(response, 200, { media: items.map(expose) });
          return;
        }
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'GET, POST');
          throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for this endpoint.');
        }
        const bytes = await readBody(request, request.headers['content-type']?.startsWith('video/') ? maxVideoUploadBytes : maxUploadBytes);
        let filename: string;
        try { filename = decodeURIComponent(String(request.headers['x-filename'] ?? 'upload')); }
        catch { throw new ApiError(400, 'INVALID_FILENAME', 'Filename header must be URI encoded.'); }
        const visibility = request.headers['x-visibility'] ?? 'private';
        if (visibility !== 'private' && visibility !== 'public') throw new ApiError(400, 'INVALID_VISIBILITY', 'Use private or public.');
        const result = await options.media.upload(bytes, request.headers['content-type'] ?? '', filename, visibility, ownerId);
        json(response, result.duplicate ? 200 : 201, { ...result, media: expose(result.media) });
        return;
      }
      const processing = /^\/api\/media\/([a-f0-9-]{36})\/process$/.exec(path);
      if (processing && options.media) {
        requireMethod('POST');
        json(response, 200, { media: expose(await options.media.process(processing[1]!, ownerId)) });
        return;
      }
      const detail = /^\/api\/media\/([a-f0-9-]{36})$/.exec(path);
      if (detail && options.media) {
        requireMethod('GET');
        const item = await options.media.get(detail[1]!, ownerId);
        json(response, 200, { media: expose(item) });
        return;
      }
      const file = /^\/api\/media\/([a-f0-9-]{36})\/file$/.exec(path);
      if (file && options.media) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.setHeader('Allow', 'GET, HEAD');
          throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or HEAD.');
        }
        const { media, bytes } = await options.media.file(file[1]!, ownerId);
        const headers = { 'Content-Type': media.contentType, 'Accept-Ranges': 'bytes',
          'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
        // HEAD describes the full representation; Range is defined for GET.
        if (request.headers.range && request.method === 'GET') {
          const range = byteRange(request.headers.range, bytes.length);
          if (!range) {
            response.writeHead(416, { ...headers, 'Content-Range': `bytes */${bytes.length}`, 'Content-Length': 0 });
            response.end(); return;
          }
          response.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`, 'Content-Length': range.end - range.start + 1 });
          response.end(bytes.subarray(range.start, range.end + 1)); return;
        }
        response.writeHead(200, { ...headers, 'Content-Length': bytes.length });
        response.end(request.method === 'HEAD' ? undefined : bytes);
        return;
      }
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      sendError(response, error);
    }
  });
}
