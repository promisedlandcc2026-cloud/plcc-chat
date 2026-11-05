import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizePoll } from '../api/_utils/communityChatSanitize.js';
import { buildVaultCommunityChatSubUrl } from '../api/_utils/vaultOrigin.js';

const ID = '11111111-1111-4111-8111-111111111111';
const MID = '22222222-2222-4222-8222-222222222222';

test('sanitizePoll keeps only member-safe fields', () => {
  const p = sanitizePoll({
    id: ID,
    messageId: MID,
    question: 'Q',
    multi: true,
    anonymous: false,
    closed: false,
    isMine: true,
    totalVoters: 3,
    myVotes: ['o1', 'zz'],
    options: [
      { id: 'o1', text: 'A', count: 2, voters: ['Ann', 'Ben'], email: 'x@y' },
      { id: 'o2', text: 'B', count: 1, voters: ['Cy'] },
      { id: '<script>', text: 'bad', count: 9 },
    ],
    created_by: 'secret',
  });
  assert.equal(p.options.length, 2);
  assert.deepEqual(p.myVotes, ['o1']);
  assert.equal(p.created_by, undefined);
  assert.equal(p.options[0].email, undefined);
});

test('sanitizePoll refuses broken polls', () => {
  assert.equal(sanitizePoll(null), null);
  assert.equal(sanitizePoll({ id: 'x', messageId: MID, options: [] }), null);
  assert.equal(sanitizePoll({ id: ID, messageId: MID, options: [{ id: 'o1', text: 'only' }] }), null);
});

test('poll routes are allowed through to the Vault', () => {
  for (const sub of ['polls', 'poll-create', 'poll-vote', 'poll-close']) {
    assert.match(buildVaultCommunityChatSubUrl('https://vault.example.com', sub), new RegExp(`subResource=${sub}$`));
  }
  const bridge = readFileSync(new URL('../api/community-chat.js', import.meta.url), 'utf8');
  assert.ok(bridge.includes("'poll-vote'") && bridge.includes("resource === 'polls'"));
});
