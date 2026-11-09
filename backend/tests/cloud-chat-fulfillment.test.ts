import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DialogflowChat, intentDateWindow } from '../src/cloud/chat.js';
import type { FirestoreMediaStore } from '../src/cloud/firestore-media.js';

test('chat fulfillment uses recognised entities for real owner-scoped AND/count and public lost-pet searches', async () => {
  const calls: unknown[][] = [];
  const sessions: string[] = [];
  const store = { search: async (...args: unknown[]) => { calls.push(args); return []; } } as unknown as FirestoreMediaStore;
  let lost = false, required = true, ambiguous = false;
  const chat = new DialogflowChat(store, async session => {
    sessions.push(session);
    return { action: lost ? 'LostPetSightings' : 'SearchSightings', allRequiredParamsPresent: required, intentDetectionConfidence: 0.99,
      parameters: { species: ['cat', 'dog'], counts: ambiguous ? [2] : [2, 1], descriptions: ['collar'] } };
  });
  const sessionId = randomUUID();
  await chat.query('alice', { message: 'two cats and one dog wearing collars', sessionId });
  assert.deepEqual(calls[0], ['alice', { cat: 2, dog: 1, collar: 1 }, undefined]);
  lost = true;
  await chat.query('alice', { message: 'lost pets', sessionId });
  assert.equal(typeof (calls[1]![2] as { since: string }).since, 'string'); // A date window invokes the store’s public-only search path.
  await chat.query('bob', { message: 'lost pets', sessionId });
  assert.notEqual(sessions[0], sessions[2]); assert.equal(sessions[0], sessions[1]);
  required = false;
  const before = calls.length;
  assert.match((await chat.query('alice', { message: 'missing pet', sessionId })).reply, /Which animal/);
  required = true; ambiguous = true;
  assert.match((await chat.query('alice', { message: 'two cats and dogs', sessionId })).reply, /one minimum count/);
  assert.equal(calls.length, before);
  await assert.rejects(chat.query('alice', { message: 'hello', sessionId: 'invalid' }), { status: 400 });
});

test('chat date entities use Melbourne day boundaries including daylight-saving transitions', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.deepEqual(intentDateWindow({ date: '2026-11-09T12:00:00+11:00' }, now), { since: '2026-11-08T13:00:00.000Z', until: '2026-11-09T12:59:59.999Z' });
  assert.deepEqual(intentDateWindow({ date: '2026-10-04T12:00:00+11:00' }, now), { since: '2026-10-03T14:00:00.000Z', until: '2026-10-04T12:59:59.999Z' });
  assert.equal(intentDateWindow({ date: '' }, now), undefined);
});
