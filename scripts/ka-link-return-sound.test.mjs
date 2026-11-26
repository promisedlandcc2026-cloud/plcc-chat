/**
 * "Members join Ka Link, go to WhatsApp, come back — and can't hear."
 * On return we rebuild the sound like a rejoin would, without hanging up.
 * Run: node --test scripts/ka-link-return-sound.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

async function load() {
  const out = await build({
    entryPoints: [join(root, 'lib/returnRecovery.ts')],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
  });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}

describe('back from another app', () => {
  it('ignores a quick glance, rebuilds after a short trip, re-subscribes after a longer one', async () => {
    const { returnPlan } = await load();
    assert.deepEqual(returnPlan(800, false), { rebuild: false, resubscribe: false, askTap: false });
    assert.deepEqual(returnPlan(4_000, false), { rebuild: true, resubscribe: false, askTap: false });
    assert.deepEqual(returnPlan(60_000, false), { rebuild: true, resubscribe: true, askTap: false });
    assert.equal(returnPlan(4_000, true).askTap, true);
    assert.equal(returnPlan(Number.NaN, true).rebuild, false);
  });

  it('knows iPhones and iPads (even iPads that say Macintosh)', async () => {
    const { isAppleMobile } = await load();
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), true);
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true);
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), false);
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A146)' }), false);
  });

  it('Ka Link rooms rebuild sound on return and any tap turns the speaker back on', () => {
    const src = read('components/community/ConnectVoiceHuddle.tsx');
    assert.match(src, /recoverAfterReturnRef\.current\(awayMs\)/);
    assert.match(src, /returnPlan\(awayMs, isAppleMobile\(\)\)/);
    assert.match(src, /addEventListener\('touchend', onTap, true\)/);
    // The tap re-hands the stream to the player (iPhone "playing but silent").
    const enable = src.slice(src.indexOf('const enableSound = useCallback'), src.indexOf('const enableSoundRef'));
    assert.match(enable, /el\.srcObject = null;\s*el\.srcObject = stream;/);
  });

  it('DM calls get the same return fix', () => {
    const src = read('context/DmCallContext.tsx');
    assert.match(src, /returnPlan\(awayMs, isAppleMobile\(\)\)/);
    assert.match(src, /DM_TAP_NOTICE/);
  });
});
