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
    assert.match(page, /swipe a chat left to delete it/);
    assert.match(page, /Got it/);
    assert.match(page, /peek=\{touch && peekPending/);
    const swipe = read('components/chat/SwipeToDelete.tsx');
    assert.match(swipe, /prefers-reduced-motion/);
  });
});
