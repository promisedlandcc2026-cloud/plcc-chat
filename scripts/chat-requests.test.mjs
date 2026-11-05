import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeChatRequest } from '../api/_utils/communityChatSanitize.js';
import { buildVaultCommunityChatSubUrl } from '../api/_utils/vaultOrigin.js';

const A = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const U = '33333333-3333-4333-8333-333333333333';

const base = {
  id: A, messageId: M, channelId: A, category: 'ride', categoryLabel: 'Ride', details: 'Ride Thursday',
  status: 'assigned', askedBy: { id: U, name: 'Ruth', email: 'x' }, helper: { id: U, name: 'Sam' },
  can: { volunteer: false, done: true, admin: true }, history: [{ action: 'created', by: 'Ruth', at: '2026-11-04T10:00:00Z' }],
};

test('request keeps only safe fields and known permissions', () => {
  const r = sanitizeChatRequest(base);
  assert.equal(r.askedBy.email, undefined);
  assert.equal(r.can.admin, undefined);
  assert.equal(r.can.done, true);
  assert.equal(r.history.length, 1);
});

test('unknown status or category is refused', () => {
  assert.equal(sanitizeChatRequest({ ...base, status: 'paid' }), null);
  assert.equal(sanitizeChatRequest({ ...base, category: 'money' }), null);
  assert.equal(sanitizeChatRequest({ ...base, id: 'x' }), null);
});

test('request routes reach the Vault', () => {
  for (const sub of ['requests', 'request-create', 'request-update']) {
    assert.match(buildVaultCommunityChatSubUrl('https://vault.example.com', sub), new RegExp(`subResource=${sub}$`));
  }
  const bridge = readFileSync(new URL('../api/community-chat.js', import.meta.url), 'utf8');
  assert.ok(bridge.includes("resource === 'request-update'"));
});
