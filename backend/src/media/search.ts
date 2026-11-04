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
  return { tags, ...dateWindow(body) };
}

export function dateWindow(body: Record<string, unknown>) {
  const now = Date.now();
  const parse = (value: unknown, fallback: number) => {
    if (value === undefined) return new Date(fallback).toISOString();
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) {
      throw new ApiError(400, 'INVALID_QUERY', 'Dates must be valid UTC ISO timestamps ending in Z.');
    }
    return new Date(value).toISOString();
  };
  const since = parse(body.since, now - 30 * 86400000);
  const until = parse(body.until, now);
  if (since > until) throw new ApiError(400, 'INVALID_QUERY', 'since must not be after until.');
  return { since, until };
}
export function lostPetImageQuery(body: Record<string, unknown>) {
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 31)) throw new ApiError(400, 'INVALID_QUERY', 'Supply at most 31 descriptive tags.');
  return { ...dateWindow(body), tags: ((body.tags ?? []) as unknown[]).map(tagName) };
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
