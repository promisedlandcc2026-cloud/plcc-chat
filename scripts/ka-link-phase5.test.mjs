/**
 * Phase 5 (Nov 2026) — PLCC members are on mobile data, not WiFi.
 *  #23/#24 Data Saver (on by default)  #25 lighter video  #26 reconnecting
 *  #28 lighter Messages  #29 lighter waiting music  #30 weak-signal badges
 *  #31 keep screen awake  #32 lock-screen controls  #33 one app, not two
 *  #34 phone call during a Ka Link
 * Run: node --test scripts/ka-link-phase5.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_SAVER_KEY,
  KA_LINK_AWAY_TOPIC,
  awayLabel,
  decodeAwayWire,
  encodeAwayWire,
  photoSettings,
  readDataSaver,
  shouldSubscribeTrack,
  signalLabel,
  signalLevel,
  videoPreload,
  writeDataSaver,
} from '../lib/kaLinkDataSaver.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe('Data Saver setting', () => {
  it('is on by default and remembers the choice', () => {
    const store = memStore();
    assert.equal(readDataSaver(store), true);
    writeDataSaver(false, store);
    assert.equal(store.getItem(DATA_SAVER_KEY), '0');
    assert.equal(readDataSaver(store), false);
    writeDataSaver(true, store);
    assert.equal(readDataSaver(store), true);
  });

  it('stays on when storage is unavailable', () => {
    assert.equal(readDataSaver(null), true);
    const broken = { getItem: () => { throw new Error('nope'); }, setItem: () => {} };
    assert.equal(readDataSaver(broken), true);
  });
});

describe('What a phone downloads in a Ka Link', () => {
  it('always gets voices, music and screen share', () => {
    for (const saver of [true, false]) {
      assert.equal(shouldSubscribeTrack('microphone', 'audio', saver), true);
      assert.equal(shouldSubscribeTrack('unknown', 'audio', saver), true); // waiting music
      assert.equal(shouldSubscribeTrack('screen_share_audio', 'audio', saver), true);
      assert.equal(shouldSubscribeTrack('screen_share', 'video', saver), true);
    }
  });

  it('skips camera video only while Data Saver is on', () => {
    assert.equal(shouldSubscribeTrack('camera', 'video', true), false);
    assert.equal(shouldSubscribeTrack('camera', 'video', false), true);
  });
});

describe('Lighter Messages', () => {
  it('makes photos smaller and stops video preloading with Data Saver', () => {
    const on = photoSettings(true);
    const off = photoSettings(false);
    assert.ok(on.maxEdge < off.maxEdge);
    assert.ok(on.quality < off.quality);
    assert.equal(off.maxEdge, 1600);
    assert.equal(videoPreload(true), 'none');
    assert.equal(videoPreload(false), 'metadata');
  });
});

describe('Signal and away status', () => {
  it('maps LiveKit quality to plain words', () => {
    assert.equal(signalLevel('excellent'), 'ok');
    assert.equal(signalLevel('good'), 'ok');
    assert.equal(signalLevel('unknown'), 'ok');
    assert.equal(signalLevel(undefined), 'ok');
    assert.equal(signalLevel('poor'), 'weak');
    assert.equal(signalLevel('lost'), 'lost');
    assert.equal(signalLabel('weak'), 'Weak signal');
    assert.equal(signalLabel('ok'), '');
  });

  it('round-trips away messages and rejects junk', () => {
    const call = encodeAwayWire({ v: 1, t: 'away', r: 'call' });
    assert.deepEqual(decodeAwayWire(call), { v: 1, t: 'away', r: 'call' });
    assert.deepEqual(decodeAwayWire(encodeAwayWire({ v: 1, t: 'back' })), { v: 1, t: 'back' });
    const enc = new TextEncoder();
    assert.equal(decodeAwayWire(enc.encode('{nope')), null);
    assert.equal(decodeAwayWire(enc.encode(JSON.stringify({ v: 1, t: 'away', r: 'hack' }))), null);
    assert.equal(decodeAwayWire(enc.encode(JSON.stringify({ v: 2, t: 'back' }))), null);
    assert.equal(decodeAwayWire(new Uint8Array(400)), null);
    assert.equal(decodeAwayWire(null), null);
    assert.equal(awayLabel('call'), 'On a phone call');
    assert.equal(awayLabel('away'), 'Listening in background');
    assert.equal(awayLabel(null), '');
  });
});

describe('Ka Link call screen wiring', () => {
  const src = read('components/community/ConnectVoiceHuddle.tsx');

  it('chooses downloads itself (Data Saver) and re-picks when tracks or the setting change', () => {
    assert.match(src, /connectLiveKitOnce\(room, tokenPayload\.url, tokenPayload\.token, \{ autoSubscribe: false \}\)/);
    assert.match(src, /shouldSubscribeTrack\(/);
    assert.match(src, /RoomEvent\.TrackPublished, \(\) => \{\s*applySubscriptions\(room\)/);
    assert.match(src, /data-testid="ka-link-data-saver"/);
    assert.match(src, /Video paused to save data/);
    assert.match(read('lib/livekitConnect.ts'), /autoSubscribe: opts\.autoSubscribe \?\? true/);
  });

  it('publishes light video and light waiting music', () => {
    assert.match(src, /VideoPresets\.h360\.resolution/);
    assert.match(src, /videoSimulcastLayers: \[VideoPresets\.h180\]/);
    assert.match(src, /audioPreset: AudioPresets\.speech,\s*dtx: false,\s*red: false/);
  });

  it('shows weak signal and phone-call status', () => {
    assert.match(src, /RoomEvent\.ConnectionQualityChanged/);
    assert.match(src, /topic === KA_LINK_AWAY_TOPIC/);
    assert.match(src, /data-testid="ka-link-away-badge"/);
    assert.match(src, /data-testid="ka-link-signal-badge"/);
    assert.equal(KA_LINK_AWAY_TOPIC, 'plcc-away');
  });

  it('mutes a member when a phone call takes the mic and keeps them muted after', () => {
    assert.match(src, /media\.addEventListener\('mute', onTaken\)/);
    assert.match(src, /micInterruptedRef\.current = true;\s*sendAwayRef\.current\('call'\)/);
    assert.match(src, /if \(micInterruptedRef\.current\) \{\s*micInterruptedRef\.current = false;\s*setNotice\(KA_LINK_BACK_MUTED_NOTICE\)/);
    assert.match(src, /if \(wasHiddenRef\.current\) \{/);
  });

  it('keeps the screen awake, shows Reconnecting, and has lock-screen controls', () => {
    assert.match(src, /useScreenWakeLock\(/);
    assert.match(src, /Reconnecting…/);
    assert.match(src, /set\('togglemicrophone'/);
    assert.match(src, /set\('hangup'/);
  });
});

describe('One app, not two', () => {
  it('banner in the browser when the app is installed', () => {
    assert.match(read('lib/installPrompt.ts'), /export async function installedAppButInBrowser/);
    assert.match(read('App.tsx'), /<OpenInAppBanner \/>/);
    const manifest = JSON.parse(read('public/manifest.json'));
    assert.equal(manifest.id, '/community/chat');
    assert.deepEqual(manifest.related_applications, [{ platform: 'webapp', url: '/manifest.json' }]);
  });

  it('a second copy of the same member closes the first (no double audio)', () => {
    assert.match(read('components/community/ConnectVoiceHuddle.tsx'), /DisconnectReason\.DUPLICATE_IDENTITY/);
  });
});
