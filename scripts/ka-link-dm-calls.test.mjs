/**
 * Private calls in DMs (Nov 20 2026): WhatsApp-style voice and video calls for every member.
 * Run: node --test scripts/ka-link-dm-calls.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('Ka Link private calls', () => {
  it('the bridge passes dm-call through to Canaan with a fixed shape', async () => {
    const bridge = read('api/community-chat.js');
    assert.match(bridge, /'dm-call',\n  'member-conduct'/);
    assert.match(bridge, /\['inbox', 'pending', 'ring', 'join', 'decline', 'end', 'status'\]\.includes\(action\)/);
    assert.match(bridge, /buildVaultCommunityChatSubUrl\(originResult\.origin, 'dm-call'\)/);
    const { buildVaultCommunityChatSubUrl } = await import('../api/_utils/vaultOrigin.js');
    assert.match(buildVaultCommunityChatSubUrl('https://canaan.example', 'dm-call'), /subResource=dm-call$/);
  });

  it('DM headers show voice and video call buttons (not group rooms)', () => {
    const room = read('pages/CommunityChatRoom.tsx');
    assert.match(room, /\{isDm && dmCall \? \(/);
    assert.match(room, /data-dm-call="voice"/);
    assert.match(room, /data-dm-call="video"/);
    assert.match(room, /placeCall\(true\)/);
    assert.match(room, /placeCall\(false\)/);
    assert.match(room, /aria-label=\{`Audio call \${roomTitle}`\}/);
    assert.match(room, /aria-label=\{`Video call \${roomTitle}`\}/);
  });

  it('the call provider sits above the routes and rings anywhere in the app', () => {
    const app = read('App.tsx');
    assert.match(app, /<DmCallProvider>\s*<AppShell \/>\s*<\/DmCallProvider>/);
    const ctx = read('context/DmCallContext.tsx');
    assert.match(ctx, /\.on\('broadcast', \{ event: 'ring' \}/);
    assert.match(ctx, /\.on\('broadcast', \{ event: 'ended' \}/);
    assert.match(ctx, /\.on\('broadcast', \{ event: 'answered' \}/);
    assert.match(ctx, /startRingtone\(\)/);
  });

  it('video is for everyone: the camera turns on for video calls without a role check', () => {
    const ctx = read('context/DmCallContext.tsx');
    assert.match(ctx, /if \(pass\.video\) \{\s*try \{\s*await room\.localParticipant\.setCameraEnabled\(true/);
    assert.ok(!/canModerate|teamRole/.test(ctx));
  });

  it('one call at a time, and never on top of a prayer room', () => {
    const ctx = read('context/DmCallContext.tsx');
    assert.match(ctx, /Leave the prayer room first, then call\./);
    assert.match(ctx, /busy on another call/);
    const screen = read('components/call/DmCallScreen.tsx');
    assert.match(screen, /disabled=\{ctx\.inPrayerRoom\}/);
  });

  it('unanswered calls stop ringing; the caller hears "No answer"', () => {
    const ctx = read('context/DmCallContext.tsx');
    assert.match(ctx, /finish\('no-answer'\)/);
    const lib = read('lib/dmCall.ts');
    assert.match(lib, /'no-answer'\) return 'No answer'/);
    assert.match(lib, /'declined'\) return 'Call declined'/);
  });

  it('opening the phone alert shows the ringing screen if the call still rings', () => {
    const room = read('pages/CommunityChatRoom.tsx');
    assert.match(room, /wantsAnswerFromUrl\(location\.search\)/);
    assert.match(room, /checkIncomingRef\.current\?\.\(channelId, roomTitle\)/);
    const sw = read('public/sw.js');
    assert.match(sw, /startsWith\('call:'\)/);
    assert.match(sw, /requireInteraction: true/);
  });

  it('a call counts as a call for the update guard and keeps the screen awake on video', () => {
    const ctx = read('context/DmCallContext.tsx');
    assert.match(ctx, /setCallActive\(true\)/);
    const screen = read('components/call/DmCallScreen.tsx');
    assert.match(screen, /useScreenWakeLock\(/);
  });

  it('phones already allow camera and microphone', () => {
    assert.match(read('ios/App/App/Info.plist'), /NSCameraUsageDescription/);
    assert.match(read('android/app/src/main/AndroidManifest.xml'), /android\.permission\.CAMERA/);
  });

  it('a missed ring ping still rings: retries the call topic and checks for a ringing call', () => {
    const ctx = read('context/DmCallContext.tsx');
    assert.match(ctx, /retryLater\(\)/);
    assert.match(ctx, /status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT' \|\| status === 'CLOSED'/);
    assert.match(ctx, /fetchPendingCall\(\)/);
    assert.match(ctx, /addEventListener\('visibilitychange', onVisible\)/);
    assert.match(ctx, /setInterval\(\(\) => void checkPending\(\), jittered\(60_000, Math\.random\(\)\)\)/);
  });
});
