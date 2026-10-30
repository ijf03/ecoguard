/** Public HTTP contract. All media links are same-origin relative paths. */
export interface Media {
  id: string;
  filename: string;
  checksum: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
  createdAt: string;
  visibility: 'private' | 'public';
  processingStatus: 'pending' | 'complete' | 'failed';
  species: Record<string, number>;
  manualTags: string[];
  detectionModel?: { identity: string; version: string; weightsSha256: string; confidence: number };
  processingError?: string;
  originalUrl: string;
  thumbnailUrl?: string;
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
export function createMediaApi(send: ApiFetch = (path, options) => fetch(path, options)) {
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await send(path, options);
    const body = await response.json();
    if (!response.ok) throw new ApiError(response.status, body.error?.code ?? 'REQUEST_FAILED', body.error?.message ?? 'Request failed.');
    return body as T;
  }
  const post = <T>(path: string, body: unknown) => request<T>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return {
    list: () => request<{ media: Media[] }>('/api/media'),
    process: (id: string) => post<{ media: Media }>(`/api/media/${encodeURIComponent(id)}/process`, {}),
    get: (id: string) => request<{ media: Media }>(`/api/media/${encodeURIComponent(id)}`),
    upload: (file: File, visibility: 'private' | 'public' = 'private') =>
      request<{ media: Media; duplicate: boolean }>('/api/media', {
        method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), 'X-Visibility': visibility }, body: file,
      }),
    search: (tags: Record<string, number>) => post<{ media: Media[] }>('/api/search', { tags }),
    lostPet: (species: string, tags: string[] = [], since?: string) =>
      post<{ media: Media[] }>('/api/search/lost-pet', { species, tags, ...(since ? { since } : {}) }),
    fromThumbnail: (thumbnailUrl: string) => post<{ media: Media }>('/api/search/thumbnail', { thumbnailUrl }),
    editTags: (urls: string[], tags: string[], operation: 0 | 1) =>
      post<{ media: Media[] }>('/api/media/tags', { urls, tags, operation }),
    delete: (urls: string[]) => post<{ deleted: number; cleanupPending: boolean }>('/api/media/delete', { urls }),
  };
}
export const mediaApi = createMediaApi();
