import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { handler } from '../src/health.js';
import { serve } from './http-helper.js';

test('Lambda health contract', async () => {
  const result = await handler();
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).status, 'ok');
});

test('real HTTP health, missing route and method errors', async (t) => {
  const call = await serve(t, createApp());
  const health = await call('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.status, 'ok');
  const missing = await call('/api/missing');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');
  const wrongMethod = await call('/api/health', 'POST');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'GET');
  assert.equal(wrongMethod.json.error.code, 'METHOD_NOT_ALLOWED');
});
