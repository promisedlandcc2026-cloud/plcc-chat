/**
 * #14 Ka Link recordings (Nov 2026).
 * Run: node --test scripts/ka-link-recording.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHuddleRecordingCommand,
  sanitizeRecordingList,
  sanitizeRecordingUrl,
} from '../api/_utils/communityChatSanitize.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const CH = '11111111-1111-4111-8111-111111111111';
const REC = '22222222-2222-4222-8222-222222222222';

describe('recording bridge', () => {
  it('accepts only known actions with the right fields', () => {
    assert.deepEqual(parseHuddleRecordingCommand({ channelId: CH, action: 'start' }), { channelId: CH, action: 'start' });
    assert.deepEqual(parseHuddleRecordingCommand({ channelId: CH, action: 'play', recordingId: REC }), { channelId: CH, action: 'play', recordingId: REC });
    assert.equal(parseHuddleRecordingCommand({ channelId: CH, action: 'play' }), null);
    assert.equal(parseHuddleRecordingCommand({ channelId: CH, action: 'start', recordingId: REC }), null);
    assert.equal(parseHuddleRecordingCommand({ channelId: CH, action: 'wipe' }), null);
    assert.equal(parseHuddleRecordingCommand({ channelId: CH, action: 'list', x: 1 }), null);
  });
  it('only passes private Supabase signed links', () => {
    assert.ok(sanitizeRecordingUrl('https://abc.supabase.co/storage/v1/object/sign/ka-link-recordings/x.mp4?token=t'));
    assert.equal(sanitizeRecordingUrl('https://evil.example.com/x.mp4'), null);
    assert.equal(sanitizeRecordingUrl('javascript:alert(1)'), null);
  });
  it('cleans the list', () => {
    const out = sanitizeRecordingList([
      { id: REC, status: 'ready', startedAt: '2026-11-19T00:03:00Z', durationSeconds: 3600.4, channelName: 'Midnight Watch' },
      { id: 'bad', status: 'ready' },
      { id: REC, status: 'failed' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].durationSeconds, 3600);
  });
});

describe('recording UI', () => {
  const huddle = read('components/community/ConnectVoiceHuddle.tsx');
  it('everyone sees REC; only moderators get the Record button', () => {
    assert.match(huddle, /RoomEvent\.RecordingStatusChanged/);
    assert.match(huddle, /className="pr-rec"/);
    assert.match(huddle, /connected && canRecord \? \([\s\S]*huddle-record-toggle/);
    // PLCC ONE rights: Record needs moderator AND the recording right (when the server sends it).
    assert.match(huddle, /const canRecord = canModerate && canRecordRight !== false;/);
  });
  it('past recordings from the call and the chat room', () => {
    assert.match(huddle, /<HuddleRecordingsSheet/);
    assert.match(read('pages/CommunityChatRoom.tsx'), /room-recordings-chip/);
  });
});
