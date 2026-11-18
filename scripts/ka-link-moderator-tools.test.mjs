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
import { orderRaisedHands, parseHandRaisedAt, parseHuddleStageView } from '../lib/huddleStage.ts';
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
    assert.deepEqual(parseHuddleStageView('{bad'), { micLock: false, readerIds: [] });
    assert.deepEqual(parseHuddleStageView(undefined), { micLock: false, readerIds: [] });
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
