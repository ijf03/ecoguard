import { ApiError } from '../http/errors.js';
import type { Media } from './contracts.js';

export function tagName(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_QUERY', 'Tags must be strings.');
  const tag = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!tag || tag.length > 80 || /[\x00-\x1f]/.test(tag)) throw new ApiError(400, 'INVALID_QUERY', 'Tags must contain 1-80 printable characters.');
  return tag;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_QUERY', 'Expected a JSON object.');
  return value as Record<string, unknown>;
}
export function countQuery(value: unknown): Record<string, number> {
  const entries = Object.entries(object(value));
  if (!entries.length || entries.length > 32) throw new ApiError(400, 'INVALID_QUERY', 'Supply 1-32 tag/count pairs.');
  const result: Record<string, number> = Object.create(null);
  for (const [name, count] of entries) {
    const tag = tagName(name);
    if (!Number.isSafeInteger(count) || Number(count) < 1) throw new ApiError(400, 'INVALID_QUERY', 'Minimum counts must be positive integers.');
    if (Object.hasOwn(result, tag)) throw new ApiError(400, 'INVALID_QUERY', 'Duplicate normalized tag.');
    result[tag] = Number(count);
  }
  return result;
}
export function matches(media: Media, tags: Record<string, number>): boolean {
  return Object.entries(tags).every(([tag, count]) => Math.max(
    Object.hasOwn(media.species, tag) ? media.species[tag]! : 0,
    media.manualTags.includes(tag) ? 1 : 0,
  ) >= count);
}
export function lostPetQuery(value: unknown) {
  const body = object(value);
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 31)) {
    throw new ApiError(400, 'INVALID_QUERY', 'tags must be an array with at most 31 items.');
  }
  const tags = Object.fromEntries([tagName(body.species), ...((body.tags ?? []) as unknown[]).map(tagName)].map(tag => [tag, 1]));
  const since = body.since === undefined ? new Date(Date.now() - 30 * 86400000).toISOString() : body.since;
  if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(since) || !Number.isFinite(Date.parse(since))) {
    throw new ApiError(400, 'INVALID_QUERY', 'since must be an ISO timestamp.');
  }
  return { tags, since: new Date(since).toISOString() };
}

export function mediaIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw new ApiError(400, 'INVALID_QUERY', 'Supply 1-100 media URLs.');
  }
  return [...new Set(value.map(url => {
    if (typeof url !== 'string') throw new ApiError(400, 'INVALID_QUERY', 'Media URLs must be strings.');
    const match = /^\/api\/media\/([a-f0-9-]{36})\/file$/.exec(url);
    if (!match) throw new ApiError(400, 'INVALID_QUERY', 'Use originalUrl values returned by this API.');
    return match[1]!;
  }))];
}
export function bulkTags(value: unknown) {
  const body = object(value);
  const ids = mediaIds(body.urls);
  if (body.operation !== 0 && body.operation !== 1) throw new ApiError(400, 'INVALID_QUERY', 'operation must be 1 (add) or 0 (remove).');
  if (!Array.isArray(body.tags) || !body.tags.length || body.tags.length > 32) throw new ApiError(400, 'INVALID_QUERY', 'Supply 1-32 tags.');
  return { ids, tags: [...new Set(body.tags.map(tagName))], operation: body.operation };
}
