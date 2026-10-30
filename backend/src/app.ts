import { createServer } from 'node:http';
import { handler } from './health.js';
import { ApiError, json, sendError } from './http/errors.js';
import { bulkTags, mediaIds, countQuery, lostPetQuery, object } from './media/search.js';
import { readBody, readJson } from './http/body.js';
import type { Media } from './media/contracts.js';
import type { MediaService } from './media/service.js';

function present(item: Media) {
  return { ...item, originalUrl: `/api/media/${item.id}/file`,
    ...(item.thumbnailKey ? { thumbnailUrl: `/api/media/${item.id}/thumbnail` } : {}) };
}
export interface AppOptions { media?: MediaService; maxUploadBytes?: number }
export function createApp(options: AppOptions = {}) {
  const maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const requireMethod = (method: string) => {
        if (request.method !== method) {
          response.setHeader('Allow', method);
          throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${method} for this endpoint.`);
        }
      };
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
        json(response, 200, { media: present(await options.media.fromThumbnail(body.thumbnailUrl)) });
        return;
      }
      const thumbnail = /^\/api\/media\/([a-f0-9-]{36})\/thumbnail$/.exec(path);
      if (thumbnail && options.media) {
        requireMethod('GET');
        const bytes = await options.media.thumbnail(thumbnail[1]!);
        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length,
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        response.end(bytes);
        return;
      }
      if (path === '/api/media/delete' && options.media) {
        requireMethod('POST');
        const body = object(await readJson(request));
        json(response, 200, await options.media.deleteMany(mediaIds(body.urls)));
        return;
      }
      if (path === '/api/media/tags' && options.media) {
        requireMethod('POST');
        const query = bulkTags(await readJson(request));
        const items = await options.media.editTags(query.ids, query.tags, query.operation);
        json(response, 200, { media: items.map(present) });
        return;
      }
      if ((path === '/api/search' || path === '/api/search/lost-pet') && options.media) {
        requireMethod('POST');
        const body = await readJson(request);
        const query = path.endsWith('lost-pet') ? lostPetQuery(body) : { tags: countQuery(object(body).tags), since: undefined };
        const items = await options.media.search(query.tags, query.since);
        json(response, 200, { media: items.map(present) });
        return;
      }
      if (path === '/api/media' && options.media) {
        if (request.method === 'GET') {
          const items = await options.media.list();
          json(response, 200, { media: items.map(present) });
          return;
        }
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'GET, POST');
          throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for this endpoint.');
        }
        const bytes = await readBody(request, maxUploadBytes);
        let filename: string;
        try { filename = decodeURIComponent(String(request.headers['x-filename'] ?? 'upload')); }
        catch { throw new ApiError(400, 'INVALID_FILENAME', 'Filename header must be URI encoded.'); }
        const visibility = request.headers['x-visibility'] ?? 'private';
        if (visibility !== 'private' && visibility !== 'public') throw new ApiError(400, 'INVALID_VISIBILITY', 'Use private or public.');
        const result = await options.media.upload(bytes, request.headers['content-type'] ?? '', filename, visibility);
        json(response, result.duplicate ? 200 : 201, { ...result, media: present(result.media) });
        return;
      }
      const processing = /^\/api\/media\/([a-f0-9-]{36})\/process$/.exec(path);
      if (processing && options.media) {
        requireMethod('POST');
        json(response, 200, { media: present(await options.media.process(processing[1]!)) });
        return;
      }
      const detail = /^\/api\/media\/([a-f0-9-]{36})$/.exec(path);
      if (detail && options.media) {
        requireMethod('GET');
        const item = await options.media.get(detail[1]!);
        json(response, 200, { media: present(item) });
        return;
      }
      const file = /^\/api\/media\/([a-f0-9-]{36})\/file$/.exec(path);
      if (file && options.media) {
        requireMethod('GET');
        const { media, bytes } = await options.media.file(file[1]!);
        response.writeHead(200, { 'Content-Type': media.contentType, 'Content-Length': bytes.length,
          'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        response.end(bytes);
        return;
      }
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      sendError(response, error);
    }
  });
}
