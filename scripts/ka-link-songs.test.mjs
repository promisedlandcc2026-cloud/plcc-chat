/**
 * #12 Ka Link song library (Nov 2026).
 * Run: node --test scripts/ka-link-songs.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHuddleSongsCommand, sanitizeSongList } from '../api/_utils/communityChatSanitize.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const CH = '11111111-1111-4111-8111-111111111111';
const S1 = '33333333-3333-4333-8333-333333333333';

describe('song library bridge', () => {
  it('only lists, for one room', () => {
    assert.deepEqual(parseHuddleSongsCommand({ channelId: CH, action: 'list' }), { action: 'list', channelId: CH });
    assert.equal(parseHuddleSongsCommand({ channelId: CH, action: 'delete' }), null);
    assert.equal(parseHuddleSongsCommand({ channelId: 'x' }), null);
  });
  it('keeps only private Supabase play links', () => {
    const out = sanitizeSongList([
      { id: S1, title: 'Oceans', url: 'https://abc.supabase.co/storage/v1/object/sign/ka-link-songs/songs/x.mp3?token=t', durationSeconds: 245 },
      { id: S1, title: 'Bad link', url: 'https://evil.example/x.mp3' },
      { id: 'nope', title: 'x' },
    ]);
    assert.equal(out.length, 2);
    assert.ok(out[0].url);
    assert.equal(out[1].url, null);
  });
});

describe('music picker in the call', () => {
  const huddle = read('components/community/ConnectVoiceHuddle.tsx');
  it('Music button opens the picker; songs play through the same room track', () => {
    assert.match(huddle, /onClick=\{openMusicSheet\}/);
    assert.match(huddle, /<HuddleMusicSheet/);
    assert.match(huddle, /audioEl\.crossOrigin = 'anonymous'/);
    assert.match(huddle, /addEventListener\('ended', \(\) => advanceMusicRef\.current\(\)\)/);
  });
});
