/**
 * Nov 27 outage: members were signed out (and dropped from Ka Link) because the
 * sign-in server didn't answer. Run: node --test scripts/ka-link-stay-signed-in.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
async function load() {
  const out = await build({ entryPoints: [join(root, 'lib/authFailure.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral' });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}

describe('staying signed in during a server outage', () => {
  it('only a clear "invalid login" signs someone out', async () => {
    const { classifyAuthFailure } = await load();
    assert.equal(classifyAuthFailure({ status: 400, code: 'refresh_token_not_found' }), 'invalid');
    assert.equal(classifyAuthFailure({ message: 'Invalid Refresh Token: Already Used' }), 'invalid');
    assert.equal(classifyAuthFailure({ status: 401 }), 'invalid');
    // Outage answers: keep them signed in.
    for (const status of [0, 500, 502, 503, 504, 520, 522, 524]) {
      assert.equal(classifyAuthFailure({ status, message: 'upstream timeout' }), 'unreachable', String(status));
    }
    assert.equal(classifyAuthFailure({ message: 'Failed to fetch' }), 'unreachable');
    assert.equal(classifyAuthFailure(null), 'unreachable');
  });

  it('keeps the login and retries instead of signing out when unreachable', () => {
    const src = readFileSync(join(root, 'context/AuthContext.tsx'), 'utf8');
    const fn = src.slice(src.indexOf('const confirmSessionGone = useCallback'), src.indexOf('const recoverSession = useCallback'));
    assert.match(fn, /outcome\.kind === 'unreachable'[\s\S]*setReinstallPending\(true\);\s*return prev;/);
    assert.match(src, /if \(outcome\.kind === 'invalid'\) \{\s*setReinstallPending\(false\);\s*applySession\(null\);/);
  });
});
