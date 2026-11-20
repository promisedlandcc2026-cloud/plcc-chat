/**
 * Warn, then block, an unruly member (Nov 19 2026) — calls and chat.
 * Run: node --test scripts/ka-link-member-conduct.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('Ka Link warn / block', () => {
  it('moderator menu offers Warn or block instead of a one-call block', () => {
    const tools = read('components/huddle/HuddleModeratorTools.tsx');
    assert.match(tools, /action: 'conduct',\s*label: 'Warn or block…'/);
    assert.ok(!/action: 'block',/.test(tools));
  });

  it('the sheet warns first and only unlocks Block after a warning', () => {
    const sheet = read('components/conduct/ConductSheet.tsx');
    assert.match(sheet, /disabled=\{busy !== null \|\| !status\?\.warnedAt\}/);
    assert.match(sheet, /I understand/);
  });

  it('a warned member sees the notice in every call layout, even minimized', () => {
    const call = read('components/community/ConnectVoiceHuddle.tsx');
    assert.match(call, /topic === HUDDLE_CONDUCT_TOPIC/);
    // handled before the "no participant" early return (Canaan sends it, not a person)
    assert.ok(call.indexOf('topic === HUDDLE_CONDUCT_TOPIC') < call.indexOf("if (!mountedRef.current || !participant) return;"));
    assert.equal((call.match(/\{conductOverlays\}/g) || []).length, 3);
  });

  it('chat: moderators can warn or block a sender; blocked members see why', () => {
    assert.match(read('components/chat/MessageActions.tsx'), /Warn or block/);
    assert.match(read('pages/CommunityChatRoom.tsx'), /place: 'chat'/);
    const bridge = read('api/community-chat.js');
    assert.match(bridge, /resource === 'member-conduct'/);
    assert.match(bridge, /errBody\.code === 'member_blocked'/);
    assert.match(bridge, /denied\?\.code === 'member_blocked'/);
    assert.match(read('api/_utils/vaultOrigin.js'), /'member-conduct'/);
  });
});
