/**
 * Leaving the app and coming back must never strand a member: no rejoin blocked forever,
 * no old connection ending the new call, and sound brought back on iPhones.
 * Run: node --test scripts/ka-link-background-return.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'components/community/ConnectVoiceHuddle.tsx'), 'utf8');
const joinStart = src.indexOf('const join = useCallback(');
const joinBody = src.slice(joinStart, src.indexOf('\n  }, [', joinStart));

describe('Ka Link: coming back from the background', () => {
  it('gives up on a stuck join so the next rejoin is not blocked', () => {
    assert.match(src, /const JOIN_WATCHDOG_MS = \d/);
    assert.match(joinBody, /const gen = \+\+joinGenRef\.current/);
    assert.match(joinBody, /joinInFlightRef\.current = false;[\s\S]*retiredRoomsRef\.current\.add\(stuck\)/);
    assert.match(joinBody, /window\.clearTimeout\(watchdog\);\s*if \(joinGenRef\.current === gen\) joinInFlightRef\.current = false;/);
  });

  it('ignores a join that finishes after it was given up on', () => {
    assert.ok(!/\n      if \(!mountedRef\.current\) return;/.test(joinBody), 'every join step checks the join number');
    assert.match(joinBody, /catch \(err\) \{\s*\/\/[^\n]*\n\s*if \(joinGenRef\.current !== gen\) return;/);
  });

  it("an old connection closing late can't end the new call", () => {
    assert.match(
      joinBody,
      /RoomEvent\.Disconnected[\s\S]{0,200}retiredRoomsRef\.current\.has\(room\) \|\| \(roomRef\.current && roomRef\.current !== room\)/
    );
    assert.match(joinBody, /RoomEvent\.Reconnected, \(\) => \{\s*if \(roomRef\.current !== room\) return;/);
  });

  it('rejoins when the phone closed the call while away', () => {
    assert.match(src, /dead\.state === ConnectionState\.Disconnected && !joinInFlightRef\.current/);
  });

  it('re-attaches sound after the background (iPhones go silent) and offers Reload if stuck', () => {
    assert.match(src, /el\.srcObject = null;\s*el\.srcObject = stream;/);
    assert.match(src, /error === JOIN_STALLED_MESSAGE[\s\S]{0,200}window\.location\.reload\(\)/);
  });
});
