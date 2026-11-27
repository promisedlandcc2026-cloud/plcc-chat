/**
 * Nov 27, 2026: name badges (Apostle / Pastor / Super Admin) and "Let them speak"
 * with mics unlocked. Run: node --test scripts/ka-link-badges-and-let-speak.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('Ka Link badges', () => {
  it('shows the signed badge before the generic Mod label', () => {
    const src = read('components/community/ConnectVoiceHuddle.tsx');
    assert.match(src, /attributes\?\.\['plcc\.badge'\]/);
    assert.match(src, /\['Apostle', 'Bishop', 'Pastor', 'Super Admin'\]\.includes\(b\)/);
    const badgeAt = src.indexOf(') : tile.badge ? (');
    const modAt = src.indexOf(') : tile.moderator ? (', badgeAt);
    assert.ok(badgeAt > 0 && modAt > badgeAt, 'badge checked first, Mod as the fallback');
  });
});

describe('Let them speak', () => {
  it('is offered for a raised hand even when mics are unlocked', () => {
    const src = read('components/huddle/HuddleModeratorTools.tsx');
    assert.match(src, /\} else if \(target\.handRaised && !target\.micOn\) \{\s*\/\/[^\n]*\n\s*out\.push\(\{ action: 'allow-mic', label: 'Let them speak'/);
  });
  it('asks them to unmute when unlocked, then lowers the hand', () => {
    const src = read('components/community/ConnectVoiceHuddle.tsx');
    const fn = src.slice(src.indexOf('const letSpeak = useCallback'), src.indexOf('const inCount ='));
    assert.match(fn, /moderate\('allow-mic', identity\)/);
    assert.match(fn, /moderate\('unmute', identity\)/);
    assert.match(fn, /return moderate\('lower-hand', identity\)/);
  });
});
