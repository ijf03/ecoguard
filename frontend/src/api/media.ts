/** Public HTTP contract. All media links are same-origin relative paths. */
export interface Media {
  id: string;
  canEdit?: boolean;
  filename: string;
  checksum: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4';
  mediaType?: 'image' | 'video';
  duration?: number;
  sampledAt?: number[];
  size: number;
  createdAt: string;
  visibility: 'private' | 'public';
  processingStatus: 'pending' | 'complete' | 'failed';
  species: Record<string, number>;
  manualTags: string[];
  detectionModel?: { identity: string; version: string; weightsSha256: string; confidence: number };
  processingError?: string;
  originalUrl: string;
  originalAvailable?: boolean;
  thumbnailUrl?: string;
  downloadUrl?: string;
  thumbnailDownloadUrl?: string;
  width?: number;
  height?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export type ApiFetch = (path: string, options?: RequestInit) => Promise<Response>;
export function createMediaApi(send: ApiFetch = (path, options) => fetch(path, options), cloudMode: () => boolean = () => false) {
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await send(path, options);
    const body = await response.json();
    if (!response.ok) throw new ApiError(response.status, body.error?.code ?? 'REQUEST_FAILED', body.error?.message ?? 'Request failed.');
    return body as T;
  }
  const post = <T>(path: string, body: unknown) => request<T>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  async function cloudImageQuery(file: File, purpose: 'collection' | 'lost-pet', options = {}) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const query = await post<{ token: string; upload: { url: string; headers: Record<string, string> } }>('/api/queries', { purpose, options, file: { checksum, size: file.size, contentType: file.type } });
    const target = new URL(query.upload.url);
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.s3.us-east-1.amazonaws.com')) throw new Error('Unexpected query storage endpoint.');
    const uploaded = await fetch(target, { method: 'PUT', headers: query.upload.headers, body: file, credentials: 'omit', redirect: 'error' });
    if (!uploaded.ok) throw new ApiError(uploaded.status, 'QUERY_UPLOAD_FAILED', 'Could not upload the temporary query image. Please retry.');
    await post('/api/queries/start', { token: query.token });
    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await post<{ pending?: true; media?: Media[] }>('/api/queries/result', { token: query.token });
      if (!result.pending) return { media: result.media ?? [] };
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('This image search took too long. Please retry; the temporary image will be cleaned up automatically.');
  }
  return {
    list: () => request<{ media: Media[] }>('/api/media'),
    chat: (message: string, sessionId: string) => post<{ reply: string; media: Media[] }>('/api/chat', { message, sessionId }),
    notificationStatus: () => request<{ enabled: boolean; pending: boolean; tags: string[] }>('/api/notifications'),
    subscribe: (tags: string[]) => post<{ enabled: boolean; pending: boolean; tags: string[] }>('/api/notifications', { tags }),
    unsubscribe: () => request<{ enabled: boolean; pending: boolean; tags: string[] }>('/api/notifications', { method: 'DELETE' }),
    process: (id: string) => post<{ media: Media }>(`/api/media/${encodeURIComponent(id)}/process`, {}),
    get: (id: string) => request<{ media: Media }>(`/api/media/${encodeURIComponent(id)}`),
    upload: async (file: File, visibility: 'private' | 'public' = 'private') => {
      if (!cloudMode()) return request<{ media: Media; duplicate: boolean }>('/api/media', {
        method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), 'X-Visibility': visibility }, body: file,
      });
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const reserved = await post<{ media: Media; duplicate: boolean; upload?: { url: string; headers: Record<string, string> } }>('/api/uploads', {
        filename: file.name, checksum, size: file.size, contentType: file.type, visibility,
      });
      if (!reserved.upload) return reserved;
      const target = new URL(reserved.upload.url);
      if (target.protocol !== 'https:' || !target.hostname.endsWith('.s3.us-east-1.amazonaws.com')) throw new Error('Unexpected upload storage endpoint.');
      // Direct storage fetch deliberately bypasses the authenticated API transport: no Cognito bearer token reaches S3.
      const uploaded = await fetch(target, { method: 'PUT', headers: reserved.upload.headers, body: file, credentials: 'omit', redirect: 'error' });
      if (!uploaded.ok && uploaded.status !== 412) throw new ApiError(uploaded.status, 'STORAGE_UPLOAD_FAILED', 'Storage upload failed. Retry the same file safely.');
      const completed = await post<{ media: Media }>(`/api/uploads/${reserved.media.id}/complete`, {});
      return { ...completed, duplicate: reserved.duplicate };
    },
    search: (tags: Record<string, number>) => post<{ media: Media[] }>('/api/search', { tags }),
    searchImage: (file: File) => cloudMode() ? cloudImageQuery(file, 'collection') : request<{ media: Media[] }>('/api/search/image', {
      method: 'POST', headers: { 'Content-Type': file.type }, body: file,
    }),
    lostPet: (species: string, tags: string[] = [], since?: string, until?: string) =>
      post<{ media: Media[] }>('/api/search/lost-pet', { species, tags, ...(since ? { since } : {}), ...(until ? { until } : {}) }),
    lostPetImage: (file: File, options: { tags?: string[]; since?: string; until?: string } = {}) => {
      if (cloudMode()) return cloudImageQuery(file, 'lost-pet', options);
      const query = new URLSearchParams();
      for (const tag of options.tags ?? []) query.append('tag', tag);
      if (options.since) query.set('since', options.since);
      if (options.until) query.set('until', options.until);
      return request<{ media: Media[] }>(`/api/search/lost-pet/image?${query}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    },
    fromThumbnail: (thumbnailUrl: string) => post<{ media: Media }>('/api/search/thumbnail', { thumbnailUrl }),
    editTags: (urls: string[], tags: string[], operation: 0 | 1) =>
      post<{ media: Media[] }>('/api/media/tags', { urls, tags, operation }),
    delete: (urls: string[]) => post<{ deleted: number; cleanupPending: boolean }>('/api/media/delete', { urls }),
  };
}
let cloudUploads = false;
export function setCloudUploads(enabled: boolean) { cloudUploads = enabled; }
let transport: ApiFetch = (path, options) => fetch(path, options);
export function setMediaTransport(send: ApiFetch) { transport = send; }
export const mediaApi = createMediaApi((path, options) => transport(path, options), () => cloudUploads);
