import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeMentionQuery,
  canEdit,
  mentionHandle,
  mentionIdsInText,
  seenBy,
  seenLabel,
  splitMentions,
  tickState,
  toggleReaction,
} from '../lib/chatMessageUtils.ts';

const ME = 'me';
const msg = (over = {}) => ({
  id: 'm', channelId: 'c', content: 'hi', isDeleted: false, createdAt: '2026-11-02T12:00:00Z',
  author: { id: ME, name: 'Me', avatarUrl: null }, parent: null, attachments: [], ...over,
});

describe('read ticks', () => {
  const readers = [
    { userId: 'a', name: 'Ann Smith', lastReadAt: '2026-11-02T12:01:00Z' },
    { userId: 'b', name: 'Paul', lastReadAt: '2026-11-02T11:00:00Z' },
    { userId: ME, name: 'Me', lastReadAt: '2026-11-02T13:00:00Z' },
  ];
  it('seen by people who read after it was sent, never the author', () => {
    assert.deepEqual(seenBy(msg(), readers).map((r) => r.userId), ['a']);
    assert.equal(tickState(seenBy(msg(), readers)), 'seen');
    assert.equal(tickState([]), 'sent');
  });
  it('labels', () => {
    assert.equal(seenLabel([], false), 'Sent');
    assert.equal(seenLabel(seenBy(msg(), readers), true), 'Seen');
    assert.equal(seenLabel(seenBy(msg(), readers), false), 'Seen by Ann');
  });
});

describe('editing', () => {
  const now = Date.parse('2026-11-02T13:00:00Z');
  it('own text messages within 24h only', () => {
    assert.equal(canEdit(msg(), ME, now), true);
    assert.equal(canEdit(msg(), 'other', now), false);
    assert.equal(canEdit(msg({ isDeleted: true }), ME, now), false);
    assert.equal(canEdit(msg({ attachments: [{ id: 'x' }] }), ME, now), false);
    assert.equal(canEdit(msg({ createdAt: '2026-11-01T12:00:00Z' }), ME, now), false);
  });
});

describe('reactions', () => {
  it('toggle on/off keeps the fixed order and drops empty', () => {
    let r = toggleReaction([], '🙏', ME);
    assert.equal(r.on, true);
    r = toggleReaction([{ emoji: '🙏', userIds: ['a'] }, ...r.next.filter((x) => x.emoji !== '🙏')], '👍', ME);
    assert.deepEqual(r.next.map((x) => x.emoji), ['👍', '🙏']);
    const off = toggleReaction([{ emoji: '👍', userIds: [ME] }], '👍', ME);
    assert.deepEqual(off, { next: [], on: false });
  });
});

describe('@mentions', () => {
  it('finds the name being typed', () => {
    assert.deepEqual(activeMentionQuery('hello @an', 9), { start: 6, query: 'an' });
    assert.deepEqual(activeMentionQuery('@', 1), { start: 0, query: '' });
    assert.equal(activeMentionQuery('email me@x', 10), null);
    assert.equal(activeMentionQuery('@ann done', 9), null);
  });
  it('first-name handles, ids only for names still in the text', () => {
    assert.equal(mentionHandle('Ann Smith'), 'Ann');
    const picked = new Map([['Ann', 'id-ann'], ['Paul', 'id-paul']]);
    assert.deepEqual(mentionIdsInText('Thanks @Ann!', picked), ['id-ann']);
    assert.deepEqual(mentionIdsInText('Thanks @Annette', picked), []);
  });
  it('highlights @names as text, never HTML', () => {
    assert.deepEqual(splitMentions('hi @Ann <b>'), [
      { text: 'hi ', mention: false },
      { text: '@Ann', mention: true },
      { text: ' <b>', mention: false },
    ]);
    assert.deepEqual(splitMentions('me@x.com'), [{ text: 'me@x.com', mention: false }]);
  });
});

import { safeHref, splitRich } from '../lib/chatMessageUtils.ts';
describe('links in messages', () => {
  it('makes web links clickable, keeps trailing punctuation as text', () => {
    assert.deepEqual(splitRich('Join PLCC The Ark: https://plcc-connect.vercel.app/ark/. Amen @Paul'), [
      { kind: 'text', text: 'Join PLCC The Ark: ' },
      { kind: 'link', text: 'https://plcc-connect.vercel.app/ark/', href: 'https://plcc-connect.vercel.app/ark/' },
      { kind: 'text', text: '. Amen ' },
      { kind: 'mention', text: '@Paul' },
    ]);
  });
  it('www links get https; dangerous schemes never become links', () => {
    assert.equal(safeHref('www.awc.org'), 'https://www.awc.org/');
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.deepEqual(splitRich('javascript:alert(1)'), [{ kind: 'text', text: 'javascript:alert(1)' }]);
    assert.equal(safeHref('https://user:pw@evil.com'), null);
  });
});

import { initialsOf, rankByRecentActivity, recentAuthorIds } from '../lib/chatMessageUtils.ts';
describe('@ list ordering', () => {
  it('initials', () => {
    assert.equal(initialsOf('Ann Mary Smith'), 'AS');
    assert.equal(initialsOf('Paul'), 'P');
  });
  it('recent speakers first, then A–Z', () => {
    const msgs = [{ author: { id: 'b' } }, { author: { id: 'c' } }, { author: { id: 'b' } }];
    assert.deepEqual(recentAuthorIds(msgs), ['b', 'c']);
    const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    assert.deepEqual(rankByRecentActivity(people, ['b', 'c']).map((p) => p.id), ['b', 'c', 'a', 'd']);
  });
});
