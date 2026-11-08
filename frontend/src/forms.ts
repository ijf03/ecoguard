/** Shared form rules mirror the documented API contract. */
function hasControlCharacters(text: string) {
  return Array.from(text).some(character => character.charCodeAt(0) < 32);
}
export function friendlyError(reason: unknown): string {
  if (reason instanceof Error && 'code' in reason &&
      ['PROCESSOR_UNAVAILABLE', 'DETECTION_FAILED', 'PROCESSING_FAILED', 'PROCESSING_TIMEOUT'].includes(String(reason.code))) {
    return 'Animal detection is currently unavailable. Please try again later; your saved originals have not been changed.';
  }
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}
export function tagsFromText(text: string): string[] {
  const tags = [...new Set(text.split(',').map(value => value.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];
  if (tags.some(tag => tag.length > 80 || hasControlCharacters(tag))) throw new Error('Each tag must contain 1–80 printable characters.');
  if (tags.length > 31) throw new Error('Use no more than 31 descriptive tags.');
  return tags;
}
export function countFilters(rows: { tag: string; count: string }[]): Record<string, number> {
  const result: Record<string, number> = Object.create(null);
  if (!rows.length || rows.length > 32) throw new Error('Use 1–32 species or tag filters.');
  for (const row of rows) {
    const tag = row.tag.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!tag || tag.length > 80 || hasControlCharacters(tag)) throw new Error('Enter a valid species or tag for every filter.');
    if (Object.hasOwn(result, tag)) throw new Error(`Combine repeated filters for “${tag}” into one row.`);
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Minimum counts must be positive whole numbers.');
    result[tag] = count;
  }
  return result;
}
export function queryDates(since: string, until: string): { since?: string; until?: string } {
  const parse = (value: string) => {
    if (!value) return undefined;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid date and time.');
    return date.toISOString();
  };
  const start = parse(since), end = parse(until);
  if (start && end && start > end) throw new Error('The start must be before the end of the date window.');
  if (start && !end && start > new Date().toISOString()) throw new Error('The start must not be in the future.');
  return { since: start, until: end };
}
export function validateFile(file: File, imagesOnly = false) {
  const image = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  const video = file.type === 'video/mp4';
  if (!image && (imagesOnly || !video)) throw new Error(imagesOnly ? 'Choose a JPEG, PNG or WebP image.' : 'Choose JPEG, PNG, WebP or an MP4/H.264 video.');
  if (file.size === 0) throw new Error('The selected file is empty.');
  if (file.size > (image ? 10 : 50) * 1024 * 1024) throw new Error(image ? 'Images must be 10 MiB or smaller.' : 'Videos must be 50 MiB or smaller.');
}
export function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}
