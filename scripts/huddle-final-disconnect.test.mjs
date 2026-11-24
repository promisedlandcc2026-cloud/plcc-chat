import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('an ended or removed huddle stays closed when the app comes back to the foreground', () => {
  const source = readFileSync(new URL('../components/community/ConnectVoiceHuddle.tsx', import.meta.url), 'utf8');
  const final = source.split('if (huddleDisconnectIsFinal(reason)) {')[1].split("logActivity('huddle_dropped'")[0];
  assert.match(final, /lostConnectionRef\.current = false;/);
  assert.doesNotMatch(final, /lostConnectionRef\.current = true;/);
  assert.match(source, /if \(!lostConnectionRef\.current\) return;[\s\S]*?logActivity\('huddle_auto_rejoin'\)/);
});
