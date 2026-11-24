import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSanctumOverflow } from '../lib/sanctumOverflow.ts';

test('only offers the PLCC Overflow entrance for a verified source channel', async (t) => {
  const channel = 'morning glory & prayer';
  const payload = {
    available: true,
    hearsJordan: true,
    joinUrl: 'https://plcc-sanctum.onrender.com/join/morning',
  };
  t.mock.method(globalThis, 'fetch', async (request) => {
    assert.equal(new URL(request).searchParams.get('jordanChannelId'), channel);
    return { ok: true, json: async () => payload };
  });

  const available = await findSanctumOverflow(channel);
  assert.equal(available.available, true);
  const entrance = new URL(available.joinUrl);
  assert.equal(entrance.origin, 'https://plcc-overflow.vercel.app');
  assert.equal(entrance.searchParams.get('channel'), channel);

  payload.hearsJordan = false;
  assert.deepEqual(await findSanctumOverflow(channel), { available: false });
  payload.hearsJordan = true;
  payload.joinUrl = 'https://example.com/join/morning';
  assert.deepEqual(await findSanctumOverflow(channel), { available: false });
});
