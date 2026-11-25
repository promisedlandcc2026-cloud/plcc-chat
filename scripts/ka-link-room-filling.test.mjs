import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const huddle = readFileSync(new URL('../components/community/ConnectVoiceHuddle.tsx', import.meta.url), 'utf8');

test('moderators see seats used out of 50 and an "open the overflow" warning from 40', () => {
  assert.match(huddle, /const ROOM_MEMBER_SEATS = 50;/);
  assert.match(huddle, /const ROOM_FULL_WARN_AT = 40;/);
  assert.match(huddle, /canModerate && !prayerWatch && peopleCount >= ROOM_FULL_WARN_AT[\s\S]*pr-fill-bar/);
  assert.match(huddle, /href=\{OVERFLOW_DASHBOARD_URL\}[\s\S]*Open overflow/);
});
