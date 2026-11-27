/**
 * Nov 27 outage: every "read" signal made every phone refetch "Seen by".
 * Run: node --test scripts/ka-link-read-receipts-pace.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
async function load() {
  const out = await build({ entryPoints: [join(root, 'lib/readReceiptsPace.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral' });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}

describe('"Seen by" refresh pace', () => {
  it('waits at least 10s between refreshes on one phone, spread out across phones', async () => {
    const { readersWaitMs } = await load();
    const now = 100_000;
    assert.ok(readersWaitMs(now - 1_000, now, 0) >= 9_000);
    assert.ok(readersWaitMs(now - 60_000, now, 0) <= 1_000);
    assert.notEqual(readersWaitMs(0, now, 0), readersWaitMs(0, now, 1));
  });

  it('the chat room no longer refetches on every read signal, and skips the background', () => {
    const src = readFileSync(join(root, 'pages/CommunityChatRoom.tsx'), 'utf8');
    assert.match(src, /readersWaitMs\(/);
    assert.match(src, /if \(readersTimerRef\.current !== null\) return;/);
    assert.match(src, /visibilityState === 'hidden'\) return;/);
  });
});
