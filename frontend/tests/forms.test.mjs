import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagsFromText, countFilters, queryDates, validateFile } from '../src/forms.ts';

test('AND count forms normalize tags, reject repeated keys and invalid thresholds', () => {
  assert.deepEqual({ ...countFilters([{ tag: '  Feral   Pig ', count: '2' }, { tag: 'cat', count: '1' }]) }, { 'feral pig': 2, cat: 1 });
  for (const count of ['', '0', '-1', '1.5', 'Infinity', 'cat']) assert.throws(() => countFilters([{ tag: 'cat', count }]));
  assert.throws(() => countFilters([{ tag: 'cat', count: '1' }, { tag: ' CAT ', count: '2' }]), /repeated/);
  assert.throws(() => countFilters([{ tag: '', count: '1' }]));
  assert.throws(() => countFilters([]));
});
test('comma-separated descriptions normalize, deduplicate and enforce bounded tags', () => {
  assert.deepEqual(tagsFromText(' Ginger, collar , GINGER, , short   hair '), ['ginger', 'collar', 'short hair']);
  assert.deepEqual(tagsFromText('  '), []);
  assert.throws(() => tagsFromText('a'.repeat(81)));
  assert.throws(() => tagsFromText('ca\u0000t'));
  assert.throws(() => tagsFromText(Array.from({ length: 32 }, (_, i) => `tag${i}`).join(',')));
});
test('date windows become UTC, preserve defaults and reject invalid/reversed ranges', () => {
  assert.deepEqual(queryDates('', ''), { since: undefined, until: undefined });
  assert.deepEqual(queryDates('2026-10-01T10:00:00+10:00', '2026-10-02T10:00:00+10:00'), { since: '2026-10-01T00:00:00.000Z', until: '2026-10-02T00:00:00.000Z' });
  assert.throws(() => queryDates('bad', ''));
  assert.throws(() => queryDates('2026-10-02T00:00Z', '2026-10-01T00:00Z'));
  assert.throws(() => queryDates('2099-01-01T00:00Z', ''));
});
test('file forms reject empty/unsupported/oversized media and video query images', () => {
  assert.doesNotThrow(() => validateFile(new File(['bytes'], 'photo.png', { type: 'image/png' }), true));
  assert.doesNotThrow(() => validateFile(new File(['bytes'], 'clip.mp4', { type: 'video/mp4' })));
  assert.throws(() => validateFile(new File(['bytes'], 'clip.mp4', { type: 'video/mp4' }), true));
  assert.throws(() => validateFile(new File([], 'empty.png', { type: 'image/png' })));
  assert.throws(() => validateFile(new File(['bytes'], 'file.svg', { type: 'image/svg+xml' })));
  assert.throws(() => validateFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })));
});
