/**
 * Nov 28 (before the Dec 6 launch): a new message no longer makes every phone
 * reload the whole conversation. Phones fetch only the messages pings name.
 * Run: node --test scripts/ka-link-light-reload.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseChatMessagesListQuery, CHAT_PAGE_MAX_IDS } from '../api/_utils/communityChatSanitize.js';
import { buildVaultCommunityChatMessagesUrl } from '../api/_utils/vaultOrigin.js';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
async function load() {
  const out = await build({ entryPoints: [join(root, 'lib/chatSync.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral' });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}
const ROOM = '11111111-1111-4111-8111-111111111111';
const id = (n) => `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222`;
const msg = (n, extra = {}) => ({ id: id(n), channelId: ROOM, content: `m${n}`, isDeleted: false, createdAt: new Date(Date.UTC(2026, 10, 28, 7, 0, n)).toISOString(), author: { id: 'a', name: 'A' }, parent: null, ...extra });

describe('light reloads: merging', () => {
  it('replaces changed messages, adds new ones in time order, keeps the last 200', async () => {
    const s = await load();
    const prev = [msg(1), msg(2), msg(3)];
    const next = s.mergeMessages(prev, [msg(4), msg(2, { content: 'edited', isDeleted: false }), msg(3, { isDeleted: true, content: '' })]);
    assert.deepEqual(next.map((m) => m.content), ['m1', 'edited', '', 'm4']);
    assert.equal(next[2].isDeleted, true);
    assert.equal(s.mergeMessages(prev, []), prev);
    const big = s.mergeMessages(Array.from({ length: 200 }, (_, i) => msg(i)), [msg(500)]);
    assert.equal(big.length, 200);
    assert.equal(big.at(-1).id, id(500));
    assert.equal(big[0].id, id(1));
  });

  it('plans: named ids only; catch-up asks for anything newer; too many or empty → full', async () => {
    const s = await load();
    const messages = [msg(1), msg(9)];
    assert.deepEqual(s.planReload({ pendingIds: new Set([id(9)]), catchUp: false, messages }), { kind: 'light', ids: [id(9)], after: null });
    assert.deepEqual(s.planReload({ pendingIds: new Set(), catchUp: true, messages }), { kind: 'light', ids: [], after: msg(9).createdAt });
    assert.deepEqual(s.planReload({ pendingIds: new Set([id(9)]), catchUp: true, messages }).after, msg(9).createdAt);
    assert.equal(s.planReload({ pendingIds: new Set(Array.from({ length: 51 }, (_, i) => id(i))), catchUp: false, messages }).kind, 'full');
    assert.equal(s.planReload({ pendingIds: new Set([id(1)]), catchUp: false, messages: [] }).kind, 'full');
    assert.equal(s.fullRefreshDue(0, 1), true);
    assert.equal(s.fullRefreshDue(1_000, 1_000 + 60_000), false);
    assert.equal(s.fullRefreshDue(1_000, 1_000 + 5 * 60_000), true);
  });
});

describe('light reloads: server proxy', () => {
  it('accepts ids / after / limit and forwards them to Canaan', () => {
    const q = parseChatMessagesListQuery({ channelId: ROOM, ids: `${id(1)},${id(2)}`, after: '2026-11-28T07:00:00Z', limit: '200' });
    assert.deepEqual(q, { ok: true, channelId: ROOM, ids: [id(1), id(2)], after: '2026-11-28T07:00:00.000Z', limit: 200 });
    const url = buildVaultCommunityChatMessagesUrl('https://canaan.example', ROOM, q);
    assert.ok(url.includes(`&ids=${id(1)},${id(2)}`));
    assert.ok(url.includes('&after=2026-11-28T07%3A00%3A00.000Z'));
    assert.ok(url.includes('&limit=200'));
    assert.equal(buildVaultCommunityChatMessagesUrl('https://canaan.example', ROOM).includes('ids='), false);
  });
  it('rejects bad light-reload params', () => {
    assert.equal(parseChatMessagesListQuery({ channelId: ROOM, ids: 'nope' }).ok, false);
    assert.equal(parseChatMessagesListQuery({ channelId: ROOM, ids: Array.from({ length: CHAT_PAGE_MAX_IDS + 1 }, (_, i) => id(i)).join(',') }).ok, false);
    assert.equal(parseChatMessagesListQuery({ channelId: ROOM, after: 'later' }).ok, false);
    assert.equal(parseChatMessagesListQuery({ channelId: ROOM, limit: '500' }).ok, false);
    assert.equal(parseChatMessagesListQuery({ channelId: ROOM, x: '1' }).ok, false);
  });
});

describe('light reloads: chat room wiring', () => {
  it('pings carry the message id and the room fetches only those', () => {
    const live = read('lib/useRoomLive.ts');
    assert.match(live, /onChangeRef\.current\(id \? \{ id \} : \{ catchUp: true \}\)/);
    const room = read('pages/CommunityChatRoom.tsx');
    assert.match(room, /pendingIdsRef\.current\.add\(change\.id\)/);
    assert.match(room, /fetchChatMessages\(channelId, \{ ids: opts\.ids \}\)/);
    assert.match(room, /mergeMessages\(prev, \[\.\.\.named, \.\.\.newer\]\)/);
    assert.match(room, /fetchChatMessages\(channelId, \{ limit: CHAT_WINDOW \}\)/);
    assert.match(room, /fullRefreshDue\(lastFullRef\.current, Date\.now\(\)\)/);
  });
});
