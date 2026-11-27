/**
 * Emergency entry (Nov 27 outage): saved membership, saved prayer room list, passes.
 * Run: node --test scripts/ka-link-emergency-entry.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

async function load(entry) {
  const out = await build({ entryPoints: [join(root, entry)], bundle: true, write: false, format: 'esm', platform: 'neutral' });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}

describe('outage cache', () => {
  beforeEach(() => store.clear());
  const me = { id: 'm1', name: 'Ann', email: null, avatarUrl: null, role: 'MEMBER', approvalStatus: 'approved', mediaNotice: null };

  it('remembers an approved membership for the same account only', async () => {
    const c = await load('lib/outageCache.ts');
    c.saveIdentity('u1', me, 1000);
    assert.equal(c.readSavedIdentity('u1', 2000).name, 'Ann');
    assert.equal(c.readSavedIdentity('u2', 2000), null, 'another account on the phone gets nothing');
    assert.equal(c.readSavedIdentity('u1', 1000 + c.IDENTITY_MAX_AGE_MS + 1), null, 'expires');
    c.saveIdentity('u3', { ...me, approvalStatus: 'pending' }, 1000);
    assert.equal(c.readSavedIdentity('u3', 2000), null, 'pending members are never cached');
  });

  it('only "server down" errors may use the saved membership', async () => {
    const c = await load('lib/outageCache.ts');
    for (const code of ['vault_unavailable', 'network', 'bridge_unconfigured']) assert.equal(c.isOutageCode(code), true, code);
    for (const code of ['unauthorized', 'forbidden', 'identity_missing', 'session_missing']) assert.equal(c.isOutageCode(code), false, code);
  });

  it('keeps the prayer room list per account', async () => {
    const c = await load('lib/outageCache.ts');
    c.savePrayerRooms('u1', [{ channelId: 'a', name: 'Morning Glory' }], 1000);
    assert.deepEqual(c.readSavedPrayerRooms('u1', 2000), [{ channelId: 'a', name: 'Morning Glory' }]);
    assert.deepEqual(c.readSavedPrayerRooms('u2', 2000), []);
  });
});

describe('wiring', () => {
  it('sign-in uses the saved membership only for server trouble, and forgets it on sign-out', () => {
    const src = read('context/AuthContext.tsx');
    assert.match(src, /isOutageCode\(code\) \? readSavedIdentity\(authUserId\) : null/);
    assert.match(src, /forgetSavedIdentity\(\);\s*try \{\s*await signOutSession\(\)/);
  });
  it('chat list keeps passes fresh and shows Join buttons when the server is down', () => {
    const src = read('pages/CommunityChat.tsx');
    assert.match(src, /void refreshEmergencyPasses\(ownerId\)/);
    assert.match(src, /data-testid="emergency-prayer-rooms"/);
    assert.match(src, /openKaLink\(\{ channelId: room\.channelId, channelName: room\.name, mode: 'join' \}\)/);
  });
  it('passes refresh at most every 6 hours (or when the account changes)', async () => {
    const src = read('lib/emergencyEntry.ts');
    assert.match(src, /PASS_REFRESH_MS = 6 \* 60 \* 60 \* 1000/);
  });
});
