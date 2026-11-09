import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { Authenticator } from '../auth.js';
import { ApiError } from '../http/errors.js';
import { bulkTags, countQuery, lostPetQuery, mediaIds, object } from '../media/search.js';
import type { CloudMedia, FirestoreMediaStore, Reservation } from './firestore-media.js';
import type { S3MediaStorage } from './s3-media.js';
import type { ImageQueries } from './image-query.js';
import type { Chatbot } from './chat.js';
import type { Notifications } from './notifications.js';

export interface CloudApiOptions {
  store: FirestoreMediaStore;
  storage: Pick<S3MediaStorage, 'upload' | 'download' | 'head' | 'cleanup'>;
  auth: Pick<Authenticator, 'verify' | 'frontendOrigin'>;
  processingAvailable: boolean;
  schedule: (id: string) => Promise<void>;
  queries?: ImageQueries;
  chat?: Chatbot;
  notifications?: Notifications;
}
export function createCloudApi({ store, storage, auth, schedule, processingAvailable, queries, chat, notifications }: CloudApiOptions) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const response = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({ statusCode,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) });
    try {
      if (headers.origin && headers.origin !== auth.frontendOrigin) throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'Use the configured application origin.');
      if (method === 'OPTIONS') return { statusCode: 204, headers: { 'Cache-Control': 'no-store' } };
      // No cloud media cookie exists: signed S3 downloads are issued only after bearer authorization.
      if (path === '/api/auth/session' && method === 'DELETE') return response(200, { signedOut: true });
      const authorization = headers.authorization;
      if (!authorization?.startsWith('Bearer ') || authorization.length > 16384) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
      const { sub: ownerId } = await auth.verify(authorization.slice(7));
      const body = () => {
        if (headers['content-type']?.split(';')[0] !== 'application/json') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
        const bytes = Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8');
        if (bytes.length > 64 * 1024) throw new ApiError(413, 'FILE_TOO_LARGE', 'JSON exceeds 64 KiB. Upload media directly to private storage.');
        try { return object(JSON.parse(bytes.toString('utf8'))); }
        catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'INVALID_JSON', 'Supply a JSON object.'); }
      };
      const present = async (item: CloudMedia) => {
        // Explicit allowlist: never expose owners, storage paths, leases, source versions or job fencing tokens.
        const downloadUrl = await storage.download(item);
        const thumbnailDownloadUrl = item.thumbnailKey ? await storage.download(item, true) : undefined;
        return { id: item.id, filename: item.filename, checksum: item.checksum, size: item.size, contentType: item.contentType,
          mediaType: item.mediaType, createdAt: item.createdAt, visibility: item.visibility, processingStatus: item.processingStatus,
          species: item.species, manualTags: item.manualTags, detectionModel: item.detectionModel, processingError: item.processingError,
          width: item.width, height: item.height, thumbnailWidth: item.thumbnailWidth, thumbnailHeight: item.thumbnailHeight,
          duration: item.duration, sampledAt: item.sampledAt, canEdit: item.ownerId === ownerId,
          originalUrl: `/api/media/${item.id}/file`, originalAvailable: Boolean(downloadUrl), ...(downloadUrl ? { downloadUrl } : {}),
          ...(item.thumbnailKey ? { thumbnailUrl: `/api/media/${item.id}/thumbnail`, thumbnailDownloadUrl } : {}) };
      };
      if (method === 'GET' && path === '/api/health') return response(200, { status: 'ok', adapter: 'aws-lambda-firestore', uploadMode: 'signed-storage' });
      if (method === 'POST' && path === '/api/auth/session') return response(200, { userId: ownerId });
      if (path === '/api/notifications') {
        if (!notifications) throw new ApiError(503, 'NOTIFICATIONS_UNAVAILABLE', 'Email alerts are not configured.');
        if (method === 'GET') return response(200, await notifications.status(ownerId));
        if (method === 'POST') {
          const input = body();
          if (Object.keys(input).some(key => key !== 'tags')) throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'Supply watched tags only. The email comes from your verified account.');
          return response(200, await notifications.subscribe(ownerId, authorization.slice(7), input.tags));
        }
        if (method === 'DELETE') { await notifications.unsubscribe(ownerId); return response(200, { enabled: false, pending: false, tags: [] }); }
      }
      if (method === 'POST' && path === '/api/chat') {
        if (!chat) throw new ApiError(503, 'CHAT_UNAVAILABLE', 'The conversation service is not configured.');
        const result = await chat.query(ownerId, body());
        return response(200, { reply: result.reply, media: await Promise.all(result.media.map(present)) });
      }
      if (method === 'POST' && path.startsWith('/api/queries')) {
        if (!queries) throw new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Image queries are not configured.');
        const input = body();
        if (path === '/api/queries') return response(201, await queries.reserve(ownerId, input));
        if (typeof input.token !== 'string') throw new ApiError(400, 'INVALID_QUERY', 'Supply your image query token.');
        if (path === '/api/queries/start') { await queries.start(ownerId, input.token); return response(202, { pending: true }); }
        if (path === '/api/queries/result') {
          const result = await queries.poll(ownerId, input.token);
          if ('pending' in result) return response(202, result);
          // Image counts select a species set: require one of each species, regardless of counts in the query.
          const tags = Object.fromEntries([...Object.keys(result.detection.species), ...(result.window?.tags ?? [])].map(tag => [tag, 1]));
          const media = Object.keys(result.detection.species).length ? await store.search(ownerId, tags, result.window) : [];
          return response(200, { media: await Promise.all(media.map(present)) });
        }
      }
      if (method === 'GET' && path === '/api/media') return response(200, { media: await Promise.all((await store.list(ownerId)).map(present)) });
      if (method === 'POST' && path === '/api/uploads') {
        const input = body();
        const allowed = new Set(['filename', 'checksum', 'size', 'contentType', 'visibility']);
        if (Object.keys(input).some(key => !allowed.has(key))) throw new ApiError(400, 'INVALID_UPLOAD', 'Unexpected upload fields. Ownership is derived from your session.');
        const result = await store.reserve(ownerId, input as unknown as Reservation);
        return response(result.duplicate ? 200 : 201, { media: await present(result.media), duplicate: result.duplicate,
          ...(result.media.phase === 'awaiting-upload' ? { upload: await storage.upload(result.media) } : {}) });
      }
      const completion = /^\/api\/uploads\/([a-f0-9-]{36})\/complete$/.exec(path);
      if (method === 'POST' && completion) {
        const item = await store.get(completion[1]!, ownerId, true);
        const uploaded = await storage.head(item);
        if (!uploaded.version || uploaded.size !== item.size || uploaded.contentType !== item.contentType || uploaded.checksum !== Buffer.from(item.checksum, 'hex').toString('base64')) throw new ApiError(422, 'UPLOAD_MISMATCH', 'The uploaded object does not match its reservation.');
        // S3 events own validation/indexing. A client completion cannot declare processing successful.
        return response(202, { media: await present(await store.get(item.id, ownerId)), duplicate: false });
      }
      if (method === 'POST' && (path === '/api/search' || path === '/api/search/lost-pet')) {
        const input = body();
        const query = path.endsWith('lost-pet') ? lostPetQuery(input) : { tags: countQuery(input.tags) };
        const window = 'since' in query ? { since: query.since, until: query.until } : undefined;
        return response(200, { media: await Promise.all((await store.search(ownerId, query.tags, window)).map(present)) });
      }
      if (method === 'POST' && path === '/api/search/thumbnail') {
        const input = body();
        const match = typeof input.thumbnailUrl === 'string' && /^\/api\/media\/([a-f0-9-]{36})\/thumbnail$/.exec(input.thumbnailUrl);
        if (!match) throw new ApiError(400, 'INVALID_QUERY', 'Use a returned thumbnail URL.');
        const item = await store.get(match[1]!, ownerId);
        if (!item.thumbnailKey) throw new ApiError(404, 'THUMBNAIL_NOT_FOUND', 'Thumbnail is unavailable.');
        return response(200, { media: await present(item) });
      }
      if (method === 'POST' && path === '/api/media/tags') {
        const query = bulkTags(body());
        return response(200, { media: await Promise.all((await store.editTags(query.ids, query.tags, query.operation, ownerId)).map(present)) });
      }
      if (method === 'POST' && path === '/api/media/delete') {
        const ids = mediaIds(body().urls);
        const items = await store.beginDelete(ids, ownerId);
        let cleanupPending = false;
        for (const item of items) {
          try { await storage.cleanup(item); await store.finishDelete(item.id); }
          catch { cleanupPending = true; }
        }
        return response(200, { deleted: items.length, cleanupPending });
      }
      const process = /^\/api\/media\/([a-f0-9-]{36})\/process$/.exec(path);
      if (method === 'POST' && process) {
        if (!processingAvailable) throw new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Cloud processing is not configured.');
        const item = await store.retry(process[1]!, ownerId);
        await schedule(item.id);
        return response(202, { media: await present(item) });
      }
      const detail = /^\/api\/media\/([a-f0-9-]{36})(?:\/(file|thumbnail))?$/.exec(path);
      if (method === 'GET' && detail) {
        const item = await store.get(detail[1]!, ownerId);
        if (!detail[2]) return response(200, { media: await present(item) });
        const url = await storage.download(item, detail[2] === 'thumbnail');
        if (!url) throw new ApiError(404, 'MEDIA_UNAVAILABLE', 'Media is awaiting validation or the thumbnail is unavailable.');
        return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' } };
      }
      if (method === 'POST' && ['/api/search/image', '/api/search/lost-pet/image'].includes(path)) throw new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Cloud image-query processing is not configured yet.');
      if (method === 'POST' && path === '/api/media') throw new ApiError(415, 'DIRECT_UPLOAD_REQUIRED', 'Reserve an upload and send bytes directly to private storage.');
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      const known = error instanceof ApiError;
      return response(known ? error.status : 500, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'The cloud request could not finish. Please retry.' } });
    }
  };
}
