/**
 * One-way sound: "she can't hear me until one of us leaves and comes back."
 * The voice watchdog re-subscribes a silent voice and restarts a dead mic by itself.
 * Run: node --test scripts/ka-link-voice-heal.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

async function loadHeal() {
  const out = await build({
    entryPoints: [join(root, 'lib/voiceHealCore.ts')],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
  });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}

describe('voice watchdog', () => {
  it('counts a stall only when packets stop moving', async () => {
    const { nextStall, VOICE_STALL_CHECKS } = await loadHeal();
    let s = { last: null, stalls: 0 };
    s = nextStall(s, 100);
    assert.equal(s.stalls, 0);
    s = nextStall(s, 150);
    assert.equal(s.stalls, 0);
    for (let i = 0; i < VOICE_STALL_CHECKS; i++) s = nextStall(s, 150);
    assert.equal(s.stalls, VOICE_STALL_CHECKS);
    // Packets flowing again clears it.
    assert.equal(nextStall(s, 151).stalls, 0);
    // New track (counter reset) is not a stall; unknown stats are not a stall.
    assert.equal(nextStall(s, 3).stalls, 0);
    assert.equal(nextStall(s, undefined).stalls, 0);
  });

  it('heals each voice at most once per cooldown', async () => {
    const { mayHeal, VOICE_HEAL_COOLDOWN_MS } = await loadHeal();
    assert.equal(mayHeal(undefined, 1000), true);
    assert.equal(mayHeal(1000, 1000 + VOICE_HEAL_COOLDOWN_MS - 1), false);
    assert.equal(mayHeal(1000, 1000 + VOICE_HEAL_COOLDOWN_MS), true);
  });

  it('never unmutes anyone and retries failed subscriptions', () => {
    const src = read('lib/voiceHeal.ts');
    assert.match(src, /TrackSubscriptionFailed/);
    assert.match(src, /rp\.isMuted/);
    assert.match(src, /pub\.isMuted/);
    assert.doesNotMatch(src, /setMicrophoneEnabled\(true\)/);
  });

  it('runs in Ka Link prayer rooms and in DM calls', () => {
    assert.match(read('components/community/ConnectVoiceHuddle.tsx'), /startVoiceHeal\(room/);
    assert.match(read('context/DmCallContext.tsx'), /startVoiceHeal\(room/);
  });

  it('re-picks subscriptions after a LiveKit reconnect', () => {
    const src = read('components/community/ConnectVoiceHuddle.tsx');
    const block = src.slice(src.indexOf('.on(RoomEvent.Reconnected'), src.indexOf('.on(RoomEvent.AudioPlaybackStatusChanged'));
    assert.match(block, /applySubscriptions\(room\)/);
  });
});
