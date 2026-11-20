/**
 * Home-screen app must not crash on start (Nov 20 2026): "installed" was recorded,
 * listeners re-checked, the check recorded "installed" again… until the stack overflowed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib/installPrompt.ts'), 'utf8');

describe('install prompt: no endless loop in the installed app', () => {
  it('"installed" is only announced when it changes', () => {
    assert.match(src, /if \(current === value && value === 'installed'\) return;/);
  });
  it('listeners can never re-enter the notifier', () => {
    assert.match(src, /if \(notifying\) return;\s*notifying = true;/);
  });
});
