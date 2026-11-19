/**
 * PLCC member feedback, Nov 19 2026: emojis on phones, fixed hand numbers, replies in
 * the Ka Link chat, video only for Pr. Grace / team / moderators, steadier voices,
 * Bible on the home screen.
 * Run: node --test --experimental-strip-types scripts/ka-link-member-feedback.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const huddle = read('components/community/ConnectVoiceHuddle.tsx');

async function load(entry) {
  const out = await build({ entryPoints: [join(root, entry)], bundle: true, write: false, format: 'esm', platform: 'neutral' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

describe('emojis show on phones', () => {
  it('the reactions picker floats (fixed) instead of sitting inside the sideways-scrolling tools row', () => {
    assert.match(huddle, /data-testid="huddle-reaction-picker"/);
    assert.match(huddle, /className="fixed z-\[460\] w-52/);
    assert.doesNotMatch(huddle, /absolute bottom-\[calc\(100%\+0\.5rem\)\] left-1\/2 z-50 w-52/);
  });
});

describe('hand numbers stay', async () => {
  const p = await load('lib/huddlePresence.ts');
  const st = await load('lib/huddleStage.ts');
  it('first raise takes the next number; lowering and raising again keeps it', () => {
    const others = [JSON.stringify({ handNo: 3 }), JSON.stringify({ handNo: 4, handRaised: false })];
    const no = p.nextHandNo([undefined, ...others]);
    assert.equal(no, 5);
    const up = p.mergeHandMetadata(undefined, true, no);
    assert.equal(p.parseHandNo(up), 5);
    const down = p.mergeHandMetadata(up, false, null);
    assert.equal(p.parseHandNo(down), 5, 'kept after lowering');
    assert.equal(JSON.parse(down).handRaised, false);
    const again = p.mergeHandMetadata(down, true, p.parseHandNo(down));
    assert.equal(p.parseHandNo(again), 5);
  });
  it('a moderator lowering the hand (server merge) keeps the number', () => {
    // Canaan's buildLowerHandMetadata merges and keeps other keys; simulate the same merge.
    const base = JSON.parse(p.mergeHandMetadata(undefined, true, 7));
    const lowered = JSON.stringify({ ...base, v: 1, handRaised: false, raisedAt: null });
    assert.equal(p.parseHandNo(lowered), 7);
  });
  it('the line follows the fixed numbers, not who lowered', () => {
    const tiles = [
      { identity: 'a', handRaised: true, raisedAt: 3000, handNo: 6 },
      { identity: 'b', handRaised: true, raisedAt: 5000, handNo: 5 },
      { identity: 'c', handRaised: true, raisedAt: 1000, handNo: 7 },
    ];
    assert.deepEqual(st.orderRaisedHands(tiles, new Map()).map((t) => t.identity), ['b', 'a', 'c']);
  });
  it('the room shows each person their own number', () => {
    assert.match(huddle, /m\.set\(t\.identity, t\.handNo \?\? i \+ 1\)/);
    assert.match(huddle, /parseHandNo\(local\.metadata\) \?\?\s*nextHandNo\(/);
  });
});

describe('reply to a message in the Ka Link chat', async () => {
  const c = await load('lib/huddleChat.ts');
  it('a reply carries a short quote; older payloads still parse', () => {
    const w = c.buildHuddleChatWirePayload({ id: 'm2', text: 'Amen!', reply: { id: 'm1', name: 'Grace', text: 'x'.repeat(300) } });
    assert.equal(w.reply.id, 'm1');
    assert.ok(w.reply.text.length <= c.HUDDLE_CHAT_REPLY_QUOTE_MAX);
    const parsed = c.parseHuddleChatWirePayload(JSON.parse(JSON.stringify(w)));
    assert.equal(parsed.reply.name, 'Grace');
    const old = c.parseHuddleChatWirePayload({ type: 'huddle_chat', v: 1, id: 'm3', text: 'hi', sentAt: 1 });
    assert.equal(old.reply, undefined);
    const msg = c.hydrateHuddleChatMessage({ payload: parsed, senderIdentity: 'u', senderName: 'U', localIdentity: 'me', localCanModerate: false });
    assert.equal(msg.reply.id, 'm1');
  });
  it('every message has a Reply button and the composer shows who you reply to', () => {
    const panel = read('components/huddle/HuddleChatPanel.tsx');
    assert.match(panel, /data-testid="huddle-chat-reply"/);
    assert.match(panel, /data-testid="huddle-chat-replying"/);
    assert.match(huddle, /sendChat = useCallback\(async \(text: string, reply\?: HuddleChatReplyRef \| null\)/);
  });
});

describe('video only for Pr. Grace, the Ka Link team and moderators', () => {
  it('members see no camera button and never turn it on at join', () => {
    assert.match(huddle, /const canUseCamera = canModerate \|\| Boolean\(localTile\?\.team\)/);
    assert.match(huddle, /!audioOnly && \(canUseCamera \|\| camEnabled\)/);
    assert.match(huddle, /if \(camEnabled && mayUseCamera\)/);
  });
});

describe('steadier voices', () => {
  it('mic: speech preset, no silence skipping, packet redundancy, voice processing on', () => {
    assert.match(huddle, /audioPreset: AudioPresets\.speech,\s*dtx: false,\s*red: true,\s*\},/);
    assert.match(huddle, /audioCaptureDefaults: \{\s*echoCancellation: true,\s*noiseSuppression: true,\s*autoGainControl: true,\s*voiceIsolation: true/);
  });
});

describe('Bible on the home screen', () => {
  it('home card opens /bible; the page uses the church reader and shares to chats', () => {
    assert.match(read('pages/CommunityChat.tsx'), /to="\/bible"[\s\S]*data-testid="home-bible-card"/);
    assert.match(read('App.tsx'), /path="\/bible"[\s\S]*<BiblePage \/>/);
    const page = read('pages/BiblePage.tsx');
    assert.match(page, /<BibleReader actions=/);
    assert.match(page, /navigate\(`\/share\?\$\{q\.toString\(\)\}`\)/);
  });
});

describe('Android call crash (Nov 19): mediaSession.setMicrophoneActive returns nothing', () => {
  it('is never followed by .catch directly; wrapped in Promise.resolve + try', () => {
    assert.doesNotMatch(huddle, /setMicrophoneActive\([^)]*\)\.catch/);
    assert.match(huddle, /Promise\.resolve\(ms\.setMicrophoneActive\(micEnabled\)\)\.catch/);
  });
});
