/**
 * Opening the Bible after an app update must not hang up a Ka Link (Nov 19 2026).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('no reload during a call', () => {
  it('the update reload waits until the call ends', () => {
    const s = read('lib/staleBuild.ts');
    assert.match(s, /if \(callActive\) \{\s*reloadAfterCall = true;\s*return false;/);
    assert.match(s, /if \(!on && reloadAfterCall\)/);
  });
  it('the call screen marks the call active and loads the Bible from the same version', () => {
    const call = read('components/community/ConnectVoiceHuddle.tsx');
    assert.match(call, /setCallActive\(true\);\s*return \(\) => setCallActive\(false\);/);
    assert.match(call, /void import\('\.\.\/\.\.\/pages\/(BiblePage|MemberBible)'\)\.catch/);
  });
});
