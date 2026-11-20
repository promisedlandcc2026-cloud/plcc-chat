/** Nov 20 2026 (database load): the LIVE dots no longer re-download the whole chat list every 10s. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
describe('Light polling', () => {
  it('chat list once every 5 minutes; LIVE status every 20s', () => {
    const c = read('context/HuddleLiveContext.tsx');
    assert.match(c, /const POLL_MS = 20_000;/);
    assert.match(c, /const CHANNEL_LIST_MS = 5 \* 60_000;/);
    assert.match(c, /if \(cached\.owner !== authUserId \|\| Date\.now\(\) - cached\.at > CHANNEL_LIST_MS\) \{/);
  });
  it('missed-ring safety check every 30s', () => {
    assert.match(read('context/DmCallContext.tsx'), /setInterval\(\(\) => void checkPending\(\), 30_000\)/);
  });
});
