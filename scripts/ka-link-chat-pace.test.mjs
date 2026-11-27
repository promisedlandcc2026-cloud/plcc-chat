/**
 * Nov 27 audit (after the "Seen by" outage): busy rooms must not make every phone
 * hit the server at the same instant. Run: node --test scripts/ka-link-chat-pace.test.mjs
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
  const out = await build({ entryPoints: [join(root, 'lib/chatPace.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral' });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}

describe('chat pacing', () => {
  it('reloads after a short random wait and marks read at most every 15s', async () => {
    const p = await load();
    assert.equal(p.reloadDelayMs(0), 300);
    assert.equal(p.reloadDelayMs(1), 2000);
    assert.equal(p.markReadDue(0, 1000), true);
    assert.equal(p.markReadDue(1000, 10_000), false);
    assert.equal(p.markReadDue(1000, 16_001), true);
    assert.equal(p.FALLBACK_POLL_MS, 15_000);
    assert.ok(p.jittered(60_000, 0) === 48_000 && p.jittered(60_000, 1) === 72_000);
  });

  it('the chat room coalesces reloads instead of reloading on every message', () => {
    const src = read('pages/CommunityChatRoom.tsx');
    assert.match(src, /onChange: scheduleReload/);
    assert.match(src, /if \(reloadTimerRef\.current !== null\) return;/);
    assert.match(src, /markReadDue\(lastMarkReadRef\.current, now\)/);
  });

  it('background checks are slower and spread out', () => {
    assert.match(read('context/HuddleLiveContext.tsx'), /const POLL_MS = 45_000;/);
    assert.match(read('context/HuddleLiveContext.tsx'), /jittered\(POLL_MS, Math\.random\(\)\)/);
    assert.match(read('context/DmCallContext.tsx'), /jittered\(60_000, Math\.random\(\)\)/);
  });
});
