import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSanctumOverflow, overflowMoveHref } from '../lib/sanctumOverflow.ts';

test('goes straight to the overflow room for a verified source channel', async (t) => {
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
  const direct = new URL(available.joinUrl);
  assert.equal(direct.origin, 'https://plcc-sanctum.onrender.com');
  assert.equal(direct.pathname, '/join/morning');
  assert.equal(direct.searchParams.get('from'), 'jordan');
  assert.equal(direct.searchParams.get('channel'), channel);

  payload.hearsJordan = false;
  assert.deepEqual(await findSanctumOverflow(channel), { available: false });
  payload.hearsJordan = true;
  payload.joinUrl = 'https://example.com/join/morning';
  assert.deepEqual(await findSanctumOverflow(channel), { available: false });
});

test('the move joins automatically and carries the name only in the #fragment', () => {
  const href = overflowMoveHref('https://plcc-sanctum.onrender.com/join/morning?from=jordan', 'Sheevon Kirabo');
  const url = new URL(href);
  assert.equal(url.searchParams.get('auto'), '1');
  assert.equal(url.searchParams.has('n'), false);
  assert.equal(decodeURIComponent(url.hash.slice(3)), 'Sheevon Kirabo');
  assert.equal(new URL(overflowMoveHref('https://plcc-sanctum.onrender.com/join/morning', '')).hash, '');
});
