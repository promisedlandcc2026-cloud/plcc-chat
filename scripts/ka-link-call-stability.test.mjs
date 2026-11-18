/**
 * Phase 1 call stability (Nov 2026):
 *  #1 sound cuts out, #2 Back button hangs up, #3 phone call logs people out.
 * Run: node --test scripts/ka-link-call-stability.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KA_LINK_REJOIN_WINDOW_MS,
  KA_LINK_RECONNECT_DELAYS_MS,
  historyStateHasKaLink,
  kaLinkReconnectDelay,
  parseKaLinkSession,
  serializeKaLinkSession,
  withKaLinkHistoryFlag,
} from '../lib/kaLinkSession.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const CH = '11111111-1111-4111-8111-111111111111';

describe('Ka Link session memory (rejoin after the phone reloads the app)', () => {
  it('round-trips a session', () => {
    const now = 1_800_000_000_000;
    const raw = serializeKaLinkSession({ channelId: CH, channelName: 'Midnight Watch', audioOnly: true, at: now });
    assert.deepEqual(parseKaLinkSession(raw, now + 1000), {
      channelId: CH,
      channelName: 'Midnight Watch',
      audioOnly: true,
      at: now,
    });
  });

  it('forgets old, future-dated, or broken sessions', () => {
    const now = 1_800_000_000_000;
    const old = serializeKaLinkSession({ channelId: CH, at: now - KA_LINK_REJOIN_WINDOW_MS - 1 });
    assert.equal(parseKaLinkSession(old, now), null);
    assert.equal(parseKaLinkSession(serializeKaLinkSession({ channelId: CH, at: now + 3_600_000 }), now), null);
    assert.equal(parseKaLinkSession('{nope', now), null);
    assert.equal(parseKaLinkSession(JSON.stringify({ channelId: '../x', at: now }), now), null);
    assert.equal(parseKaLinkSession(null, now), null);
  });
});

describe('Ka Link reconnect waits', () => {
  it('grows the wait and stops after the last attempt', () => {
    assert.equal(kaLinkReconnectDelay(0), 1000);
    for (let i = 1; i < KA_LINK_RECONNECT_DELAYS_MS.length; i += 1) {
      assert.ok(kaLinkReconnectDelay(i) >= kaLinkReconnectDelay(i - 1));
    }
    assert.equal(kaLinkReconnectDelay(KA_LINK_RECONNECT_DELAYS_MS.length), null);
    assert.equal(kaLinkReconnectDelay(-1), null);
    const total = KA_LINK_RECONNECT_DELAYS_MS.reduce((a, b) => a + b, 0);
    assert.ok(total >= 60_000, 'keeps trying for at least a minute on weak data');
  });
});

describe('Back button minimizes instead of hanging up', () => {
  it('marks and detects the "Ka Link open" history entry without losing router state', () => {
    const state = withKaLinkHistoryFlag({ returnTo: '/x' });
    assert.equal(historyStateHasKaLink(state), true);
    assert.equal(state.returnTo, '/x');
    assert.equal(historyStateHasKaLink(null), false);
    assert.equal(historyStateHasKaLink({}), false);
  });

  it('keeps the call above the routes, not inside the chat page', () => {
    const app = read('App.tsx');
    assert.match(app, /<ActiveKaLinkProvider>\s*<AppShell \/>/);
    const room = read('pages/CommunityChatRoom.tsx');
    assert.doesNotMatch(room, /<ConnectVoiceHuddle/);
    assert.match(room, /openKaLink\(/);
    const provider = read('context/ActiveKaLinkContext.tsx');
    assert.match(provider, /<ConnectVoiceHuddle[\s\S]*minimized=\{minimized\}[\s\S]*onMinimizedChange=/);
  });
});

describe('Sound and mic recovery', () => {
  const huddle = read('components/community/ConnectVoiceHuddle.tsx');
  it('follows LiveKit quick resume instead of hanging up', () => {
    assert.match(huddle, /RoomEvent\.Reconnecting/);
    assert.match(huddle, /RoomEvent\.Reconnected/);
  });
  it('asks for a tap when the phone blocks sound', () => {
    assert.match(huddle, /RoomEvent\.AudioPlaybackStatusChanged/);
    assert.match(huddle, /startAudio\(\)/);
  });
  it('repairs the mic only if it was on (never unmutes anyone)', () => {
    assert.match(huddle, /if \(!micEnabledRef\.current\) return;[\s\S]*restartTrack\(\)/);
  });
  it('waits for the network when offline', () => {
    assert.match(huddle, /navigator\.onLine === false/);
  });
});

describe('Member gate does not kick people out after an interruption', () => {
  it('keeps a confirmed member on the page while access is re-checked', () => {
    const gate = read('components/auth/MemberGate.tsx');
    assert.match(gate, /confirmedApprovedUserId/);
    assert.match(gate, /TRANSIENT_IDENTITY_ERRORS/);
    assert.doesNotMatch(gate, /TRANSIENT_IDENTITY_ERRORS = new Set\([^)]*forbidden/);
  });
});
