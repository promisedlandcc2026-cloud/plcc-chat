/**
 * Phase 2 Ka Link moderator tools (Nov 2026): #5 mute/unmute, #6 first-come hands,
 * #7 lower all hands, #8 mic lock + let speak, #11 Bible readers, #16 remove/block.
 * Run: node --test scripts/ka-link-moderator-tools.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderRaisedHands, parseHuddleHostId, parseHandRaisedAt, parseHuddleStageView } from '../lib/huddleStage.ts';
import { parseHuddleModerateCommand } from '../api/_utils/communityChatSanitize.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const CH = '11111111-1111-4111-8111-111111111111';

describe('first come, first served hands (#6)', () => {
  it('orders by when the hand went up, not by name', () => {
    const seen = new Map();
    const tiles = [
      { identity: 'a', name: 'Aaron', handRaised: true, raisedAt: 3000 },
      { identity: 'z', name: 'Zoe', handRaised: true, raisedAt: 1000 },
      { identity: 'm', name: 'Mary', handRaised: false, raisedAt: null },
      { identity: 'b', name: 'Ben', handRaised: true, raisedAt: 2000 },
    ];
    assert.deepEqual(orderRaisedHands(tiles, seen).map((t) => t.identity), ['z', 'b', 'a']);
  });
  it('a hand without a time keeps the place this device first saw it', () => {
    const seen = new Map();
    orderRaisedHands([{ identity: 'x', handRaised: true, raisedAt: null }], seen, 500);
    const order = orderRaisedHands(
      [
        { identity: 'y', handRaised: true, raisedAt: 900 },
        { identity: 'x', handRaised: true, raisedAt: null },
      ],
      seen,
      2000
    );
    assert.deepEqual(order.map((t) => t.identity), ['x', 'y']);
  });
  it('lowering a hand sends a new raise to the back', () => {
    const seen = new Map();
    orderRaisedHands([{ identity: 'x', handRaised: true, raisedAt: null }], seen, 1);
    orderRaisedHands([{ identity: 'x', handRaised: false, raisedAt: null }], seen, 2);
    assert.equal(seen.has('x'), false);
  });
  it('reads raisedAt from participant metadata', () => {
    assert.equal(parseHandRaisedAt(JSON.stringify({ handRaised: true, raisedAt: 42 })), 42);
    assert.equal(parseHandRaisedAt(JSON.stringify({ handRaised: false, raisedAt: 42 })), null);
    assert.equal(parseHandRaisedAt('nope'), null);
  });
});

describe('stage from room metadata (#8, #11)', () => {
  it('parses mic lock and readers, ignores junk', () => {
    const meta = JSON.stringify({ hostId: 'h', stage: { micLock: true, readerIds: ['r1', 5, ''] } });
    assert.deepEqual(parseHuddleStageView(meta), { micLock: true, readerIds: ['r1'] });
    // PLCC (Nov 25 2026): mics open unless a moderator locked them (micLock: true).
    assert.deepEqual(parseHuddleStageView('{bad'), { micLock: false, readerIds: [] });
    assert.deepEqual(parseHuddleStageView(undefined), { micLock: false, readerIds: [] });
    assert.deepEqual(parseHuddleStageView(JSON.stringify({ hostId: 'h' })), { micLock: false, readerIds: [] });
    assert.deepEqual(parseHuddleStageView(JSON.stringify({ stage: { micLock: false } })), { micLock: false, readerIds: [] });
  });
  it('reads the host (moderator who opened the room)', () => {
    assert.equal(parseHuddleHostId(JSON.stringify({ hostId: 'h1' })), 'h1');
    assert.equal(parseHuddleHostId('{bad'), null);
    assert.equal(parseHuddleHostId(undefined), null);
  });
});

describe('host mute reminders (Nov 25 2026)', () => {
  it('only the host gets the reminder tools', () => {
    const tools = readFileSync(join(root, 'components/huddle/HuddleModeratorTools.tsx'), 'utf8');
    assert.match(tools, /isHost && target\.micOn && !target\.moderator/);
    const call = readFileSync(join(root, 'components/community/ConnectVoiceHuddle.tsx'), 'utf8');
    assert.match(call, /onRemindMute=\{isHost \?/);
  });
  it('forwards remind-mute-all as a room action and ask-mute with a target', () => {
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'remind-mute-all' }).forward.action, 'remind-mute-all');
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'ask-mute', targetIdentity: 'u1' }).forward.targetIdentity, 'u1');
  });
  it('members accept the ask-mute notice', () => {
    const conduct = readFileSync(join(root, 'lib/memberConduct.ts'), 'utf8');
    assert.match(conduct, /v\.t !== 'ask-mute'/);
  });
});

describe('huddle-moderate bridge command', () => {
  it('maps mute/unmute and lower-hand to the existing Canaan endpoints', () => {
    assert.deepEqual(parseHuddleModerateCommand({ channelId: CH, action: 'mute', targetIdentity: 'u1' }), {
      action: 'mute',
      subResource: 'voice-participant-mute',
      forward: { channelId: CH, targetIdentity: 'u1', muted: true },
    });
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'unmute', targetIdentity: 'u1' }).forward.muted, false);
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'lower-hand', targetIdentity: 'u1' }).subResource, 'voice-hand-lower');
  });
  it('sends stage actions to voice-huddle-stage', () => {
    assert.deepEqual(parseHuddleModerateCommand({ channelId: CH, action: 'mic-lock' }).forward, { channelId: CH, action: 'mic-lock' });
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'block', targetIdentity: 'u1' }).subResource, 'voice-huddle-stage');
  });
  it('routes bulk microphone actions without accepting a participant identity', () => {
    for (const action of ['mute-all', 'unmute-all']) {
      assert.deepEqual(parseHuddleModerateCommand({ channelId: CH, action }), {
        action,
        subResource: 'voice-huddle-stage',
        forward: { channelId: CH, action },
      });
      assert.equal(parseHuddleModerateCommand({ channelId: CH, action, targetIdentity: 'u1' }), null);
    }
  });
  it('rejects bad input', () => {
    assert.equal(parseHuddleModerateCommand({ channelId: 'x', action: 'mute', targetIdentity: 'u1' }), null);
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'nuke' }), null);
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'remove' }), null);
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'mic-lock', targetIdentity: 'u1' }), null);
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'mute', targetIdentity: 'a b' }), null);
    assert.equal(parseHuddleModerateCommand({ channelId: CH, action: 'mute', targetIdentity: 'u', extra: 1 }), null);
  });
});

describe('UI wiring', () => {
  const huddle = read('components/community/ConnectVoiceHuddle.tsx');
  it('moderators get the room bar and per-person actions', () => {
    assert.match(huddle, /<ModeratorRoomBar/);
    assert.match(huddle, /<PersonActionsSheet/);
    assert.match(huddle, /RoomEvent\.RoomMetadataChanged/);
  });
  it('members see a clear message when mics are locked', () => {
    assert.match(huddle, /HUDDLE_MIC_LOCKED_NOTICE/);
    assert.match(huddle, /HUDDLE_MIC_ALLOWED_NOTICE/);
  });
  it('the bridge allows the new resource', () => {
    const api = read('api/community-chat.js');
    assert.match(api, /'huddle-moderate'/);
    assert.match(api, /huddle_blocked/);
  });
});
