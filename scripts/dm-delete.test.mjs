/**
 * Delete chat for direct messages (Nov 2026).
 * Run: node --test scripts/dm-delete.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('DM delete', () => {
  it('proxies dm-delete as POST with only a channelId', () => {
    const api = read('api/community-chat.js');
    assert.match(api, /'dm-delete',/);
    assert.match(api, /resource === 'dm-delete'/);
    assert.match(api, /Object\.keys\(b\)\.some\(\(k\) => k !== 'channelId'\)/);
  });
  it('client calls dm-delete', () => {
    assert.match(read('lib/communityChatClient.ts'), /postJson\('dm-delete', \{ channelId \}/);
  });
  it('Messages rows swipe to delete and ask first', () => {
    const page = read('pages/CommunityChat.tsx');
    assert.match(page, /<SwipeToDelete/);
    assert.match(page, /Delete chat with \{confirmDelete\.title\}\?/);
    assert.match(page, /isDmId\(rowMenu\.id\)/);
    const swipe = read('components/chat/SwipeToDelete.tsx');
    assert.match(swipe, /touchAction: 'pan-y'/);
  });
});

describe('DM swipe hint', () => {
  it('peeks once and shows a dismissible tip', () => {
    const page = read('pages/CommunityChat.tsx');
    assert.match(page, /swipe a chat left to archive or delete it/);
    assert.match(page, /Got it/);
    assert.match(page, /peek=\{touch && peekPending/);
    const swipe = read('components/chat/SwipeToDelete.tsx');
    assert.match(swipe, /prefers-reduced-motion/);
  });
});

import { parseDmBlockCommand, parseDmReportCommand, sanitizeDmList } from '../api/_utils/communityChatSanitize.js';
const CID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';

describe('DM block + report', () => {
  it('block takes only channelId + boolean', () => {
    assert.deepEqual(parseDmBlockCommand({ channelId: CID, blocked: true }), { channelId: CID, blocked: true });
    assert.equal(parseDmBlockCommand({ channelId: CID, blocked: 'yes' }), null);
    assert.equal(parseDmBlockCommand({ channelId: CID, blocked: true, userId: PID }), null);
  });
  it('report needs a known reason and a short note', () => {
    assert.deepEqual(parseDmReportCommand({ channelId: CID, reason: 'money', note: ' sent 50k ', block: true }), {
      channelId: CID, reason: 'money', note: 'sent 50k', block: true,
    });
    assert.equal(parseDmReportCommand({ channelId: CID, reason: 'nope' }), null);
    assert.equal(parseDmReportCommand({ channelId: CID, reason: 'spam', note: 'x'.repeat(501) }), null);
  });
  it('dm list carries the blocked flag', () => {
    const [row] = sanitizeDmList({ conversations: [{ channelId: CID, partnerId: PID, partnerName: 'Joy', blocked: true }] });
    assert.equal(row.blocked, true);
  });
  it('UI: swipe tray archives, menu blocks and reports', () => {
    const page = read('pages/CommunityChat.tsx');
    assert.match(page, /onArchive=\{\(\) => archiveFromSwipe/);
    assert.match(page, /Report to church leaders/);
    assert.match(page, /Block and report/);
    assert.match(page, / · Blocked/);
    assert.match(read('components/chat/SwipeToDelete.tsx'), /bg-slate-500/);
    assert.match(read('api/community-chat.js'), /denied\?\.code === 'blocked'/);
  });
});

describe('DM safety inside the chat', () => {
  it('open DM has a ⋯ menu with Block and Report, sharing the list sheets', () => {
    const room = read('pages/CommunityChatRoom.tsx');
    assert.match(room, /More options for \$\{roomTitle\}/);
    assert.match(room, /<DmBlockSheet/);
    assert.match(room, /<DmReportSheet/);
    assert.match(room, /You blocked \{roomTitle\}\. They can’t message you\./);
    const list = read('pages/CommunityChat.tsx');
    assert.match(list, /<DmBlockSheet/);
    assert.match(list, /<DmReportSheet/);
  });
});
