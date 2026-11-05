/**
 * Live Huddle fail-safes (mirrors PLCC Canaan, Oct 2026):
 * database-down saved permission, shared line + Daily backup, start retries.
 * Run: node --test scripts/test-huddle-failsafe.mjs
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  parseHuddleFallbackCommand,
  parseHuddleLineCommand,
  parseVaultDailyTokenResponse,
  parseVaultHuddleTokenResponse,
  sanitizeDailyUrl,
  sanitizeHuddleFallbackPass,
} from '../api/_utils/communityChatSanitize.js';
import { buildVaultHuddleFailsafeUrl } from '../api/_utils/vaultOrigin.js';
import chatHandler from '../api/community-chat.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const ORIGIN = 'https://plcc-opal.vercel.app';
const CH = '11111111-1111-4111-8111-111111111111';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const PASS = `${b64({ userId: 'u', channelId: CH, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
const JWT = 'aaa.bbb.ccc';

describe('sanitizers', () => {
  it('passes the Vault permission through, opaque and bounded', () => {
    const parsed = parseVaultHuddleTokenResponse({
      ok: true, token: 'lk', url: 'wss://awc.livekit.cloud', roomName: 'awc-channel-x', channelId: CH,
      fallbackPass: PASS, hostId: 'secret-host',
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.token.fallbackPass, PASS);
    assert.equal('hostId' in parsed.token, false);
    assert.equal(sanitizeHuddleFallbackPass('not a pass!'), null);
    assert.equal(sanitizeHuddleFallbackPass('a'.repeat(3000) + '.b'), null);
  });

  it('fallback / line commands accept only the expected fields', () => {
    assert.equal(parseHuddleFallbackCommand({ channelId: CH, fallbackPass: PASS }).ok, true);
    assert.equal(parseHuddleFallbackCommand({ channelId: CH, fallbackPass: PASS, userId: 'x' }).ok, false);
    assert.equal(parseHuddleFallbackCommand({ channelId: 'nope', fallbackPass: PASS }).ok, false);
    assert.deepEqual(parseHuddleLineCommand({ channelId: CH }), { ok: true, channelId: CH, provider: null });
    assert.equal(parseHuddleLineCommand({ channelId: CH, provider: 'daily' }).provider, 'daily');
    assert.equal(parseHuddleLineCommand({ channelId: CH, provider: 'zoom' }).ok, false);
  });

  it('Daily credentials only for daily.co rooms', () => {
    assert.equal(sanitizeDailyUrl('https://awc.daily.co/awc-ch-1'), 'https://awc.daily.co/awc-ch-1');
    assert.equal(sanitizeDailyUrl('https://evil.example.com/daily.co'), null);
    assert.equal(sanitizeDailyUrl('http://awc.daily.co/x'), null);
    const d = parseVaultDailyTokenResponse({ ok: true, provider: 'daily', token: 't', url: 'https://awc.daily.co/r', roomName: 'r', channelId: CH });
    assert.equal(d.ok, true);
    assert.equal(d.daily.provider, 'daily');
  });

  it('uses the fixed Vault fail-safe routes', () => {
    assert.match(buildVaultHuddleFailsafeUrl(ORIGIN, 'fallback'), /subResource=chat&subResource=voice-token-fallback$/);
    assert.match(buildVaultHuddleFailsafeUrl(ORIGIN, 'line'), /subResource=voice-huddle-provider$/);
    assert.match(buildVaultHuddleFailsafeUrl(ORIGIN, 'daily'), /subResource=voice-daily-token$/);
  });
});

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: undefined };
  res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
  res.status = (c) => ((res.statusCode = c), { json: (b) => (res.body = b) });
  return res;
}

describe('bridge', () => {
  const realFetch = globalThis.fetch;
  let calls;
  let reply;
  beforeEach(() => {
    process.env.VAULT_API_ORIGIN = ORIGIN;
    calls = [];
    reply = { status: 200, body: { ok: true } };
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
    };
  });
  afterEach(() => (globalThis.fetch = realFetch));
  const run = async (resource, body, auth = `Bearer ${JWT}`) => {
    const res = mockRes();
    await chatHandler(
      { method: 'POST', query: { resource }, headers: { authorization: auth, 'content-type': 'application/json' }, body },
      res
    );
    return res;
  };

  it('database-down route works without a session and forwards only the pass', async () => {
    reply.body = { ok: true, fallback: true, token: 'lk', url: 'wss://awc.livekit.cloud', roomName: 'r', channelId: CH };
    const res = await run('huddle-token-fallback', { channelId: CH, fallbackPass: PASS }, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.fallback, true);
    assert.match(calls[0].url, /voice-token-fallback$/);
    assert.equal('Authorization' in calls[0].init.headers, false, 'pass is the credential');
    assert.deepEqual(JSON.parse(calls[0].init.body), { channelId: CH, fallbackPass: PASS });
  });

  it('expired permission is explained, not a generic error', async () => {
    reply = { status: 401, body: { ok: false, error: 'expired' } };
    const res = await run('huddle-token-fallback', { channelId: CH, fallbackPass: PASS }, undefined);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'fallback_expired');
  });

  it('line read and claim, and the backup-line token', async () => {
    reply.body = { ok: true, provider: 'daily', channelId: CH };
    const read1 = await run('huddle-line', { channelId: CH });
    assert.equal(read1.body.provider, 'daily');
    reply = { status: 409, body: { ok: false, provider: 'daily', occupied: true, error: 'This huddle is on the backup line.' } };
    const claim = await run('huddle-line', { channelId: CH, provider: 'livekit' });
    assert.equal(claim.statusCode, 409);
    assert.equal(claim.body.provider, 'daily');
    reply = { status: 200, body: { ok: true, provider: 'daily', token: 't', url: 'https://awc.daily.co/r', roomName: 'r', channelId: CH } };
    const daily = await run('huddle-daily-token', { channelId: CH });
    assert.equal(daily.statusCode, 200);
    assert.equal(daily.body.url, 'https://awc.daily.co/r');
    reply = { status: 503, body: { ok: false, error: 'Backup huddle audio is not configured yet.', configured: false } };
    const off = await run('huddle-daily-token', { channelId: CH });
    assert.equal(off.body.code, 'backup_line_unconfigured');
  });
});

// ---------------------------------------------------------------------------
// Client logic (bundled), with fake storage + fetch
// ---------------------------------------------------------------------------

async function loadClient() {
  const out = await build({
    entryPoints: [join(root, 'lib/huddleFailsafe.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://fakeref.supabase.co"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"anon"' },
    plugins: [{
      name: 'stub-auth',
      setup(b) {
        b.onResolve({ filter: /\/authAccessToken$/ }, () => ({ path: 'auth', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const getValidAccessToken = async () => globalThis.__token ?? "aaa.bbb.ccc"; export const refreshAccessToken = async () => null;',
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('client', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.localStorage = fakeStorage();
    globalThis.sessionStorage = fakeStorage();
    globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    globalThis.__token = undefined;
  });
  afterEach(() => (globalThis.fetch = realFetch));

  const respond = (routes) => {
    const seen = [];
    globalThis.fetch = async (url, init) => {
      const resource = new URL(String(url), 'http://x').searchParams.get('resource');
      seen.push(resource);
      const next = routes[resource]?.shift?.() ?? routes[resource];
      if (next instanceof Error) throw next;
      return { ok: next.status < 300, status: next.status, json: async () => next.body, clone() { return this; } };
    };
    return seen;
  };

  it('saves the permission, retries a hiccup, and succeeds', async () => {
    const c = await loadClient();
    const seen = respond({
      'huddle-token': [
        { status: 502, body: { ok: false, code: 'vault_unavailable' } },
        { status: 200, body: { ok: true, token: 'lk', url: 'wss://x', roomName: 'r', channelId: CH, channelName: 'Prayer', fallbackPass: PASS } },
      ],
    });
    const retries = [];
    const t = await c.fetchHuddleTokenResilient(CH, { delaysMs: [1, 1], onRetry: (n) => retries.push(n) });
    assert.equal(t.token, 'lk');
    assert.deepEqual(retries, [1]);
    assert.equal(c.readHuddleFallbackPass(CH), PASS);
    assert.deepEqual(seen, ['huddle-token', 'huddle-token']);
  });

  it('database down: uses the saved permission after the retries', async () => {
    const c = await loadClient();
    c.saveHuddleFallbackPass(CH, PASS);
    const seen = respond({
      'huddle-token': { status: 503, body: { ok: false, code: 'huddle_unavailable' } },
      'huddle-token-fallback': { status: 200, body: { ok: true, fallback: true, token: 'lk2', url: 'wss://x', roomName: 'r', channelId: CH } },
    });
    const t = await c.fetchHuddleTokenResilient(CH, { delaysMs: [1, 1] });
    assert.equal(t.fallback, true);
    assert.equal(t.token, 'lk2');
    assert.deepEqual(seen, ['huddle-token', 'huddle-token', 'huddle-token', 'huddle-token-fallback']);
  });

  it('no saved permission: clear message, no fallback call', async () => {
    const c = await loadClient();
    const seen = respond({ 'huddle-token': { status: 502, body: { ok: false } } });
    await assert.rejects(c.fetchHuddleTokenResilient(CH, { delaysMs: [1, 1] }), /database is temporarily unavailable/);
    assert.equal(seen.includes('huddle-token-fallback'), false);
  });

  it('does not retry real refusals (no access)', async () => {
    const c = await loadClient();
    const seen = respond({ 'huddle-token': { status: 403, body: { ok: false, code: 'forbidden' } } });
    await assert.rejects(c.fetchHuddleTokenResilient(CH, { delaysMs: [1, 1] }));
    assert.equal(seen.length, 1);
  });

  it('expired permissions are dropped from the phone', async () => {
    const c = await loadClient();
    const old = `${b64({ userId: 'u', channelId: CH, exp: 100 })}.c2ln`;
    c.saveHuddleFallbackPass(CH, old);
    assert.equal(c.readHuddleFallbackPass(CH), '');
  });

  it('joins the same line as everyone else; Daily after LiveKit runs out', async () => {
    const c = await loadClient();
    respond({ 'huddle-line': { status: 200, body: { ok: true, provider: 'livekit' } } });
    assert.deepEqual(await c.planHuddleLine(CH), { provider: 'livekit' });

    respond({
      'huddle-line': { status: 200, body: { ok: true, provider: 'daily' } },
      'huddle-daily-token': { status: 200, body: { ok: true, token: 'd', url: 'https://awc.daily.co/r', channelId: CH } },
    });
    const daily = await c.planHuddleLine(CH);
    assert.equal(daily.provider, 'daily');
    assert.equal(daily.creds.url, 'https://awc.daily.co/r');

    // Line unknown, but LiveKit just ran out of minutes on this phone → Daily.
    c.rememberLiveKitQuota();
    respond({
      'huddle-line': { status: 200, body: { ok: true, provider: null } },
      'huddle-daily-token': { status: 200, body: { ok: true, token: 'd', url: 'https://awc.daily.co/r', channelId: CH } },
    });
    assert.equal((await c.planHuddleLine(CH)).provider, 'daily');
  });
});

describe('huddle screen wiring', () => {
  it('plans the line, uses resilient tokens, detects quota, and renders the backup line', () => {
    const src = read('components/community/ConnectVoiceHuddle.tsx');
    assert.match(src, /planHuddleLine\(channelId\)/);
    assert.match(src, /fetchHuddleTokenResilient\(channelId/);
    assert.match(src, /connectLiveKitOnce\(room/);
    assert.match(src, /err instanceof LiveKitQuotaError/);
    assert.match(src, /claimHuddleLine\(channelId, 'livekit'\)/);
    assert.match(src, /<DailyBackupHuddle/);
    const daily = read('components/community/DailyBackupHuddle.tsx');
    assert.match(daily, /'awc\.huddle\.hand'/, 'raised hands interoperate with Vault');
    assert.match(daily, /useScreenWakeLock/);
    assert.match(daily, /setLocalAudio\(false\)/);
  });

});
