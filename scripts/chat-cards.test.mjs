import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeChatCard, sanitizeCardOptions } from '../api/_utils/communityChatSanitize.js';
import { buildVaultCommunityChatSubUrl } from '../api/_utils/vaultOrigin.js';

const M = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';

test('event card: safe fields and https links only', () => {
  const c = sanitizeChatCard({
    messageId: M,
    kind: 'event',
    event: { id: E, title: 'Grand Family Celebration', startsAt: '2026-11-26T17:00:00', signupUrl: 'javascript:alert(1)', imageUrl: 'https://x.y/a.jpg', going: true, goingCount: 4, secret: 1 },
  });
  assert.equal(c.event.signupUrl, null);
  assert.equal(c.event.imageUrl, 'https://x.y/a.jpg');
  assert.equal(c.event.going, true);
  assert.equal(c.event.secret, undefined);
});

test('serve card: only known sign-up states', () => {
  const c = sanitizeChatCard({ messageId: M, kind: 'serve', serve: { id: E, title: 'Ushers', spotsLeft: 2, capacity: 5, mySignup: 'declined' } });
  assert.equal(c.serve.mySignup, null);
  assert.equal(c.serve.spotsLeft, 2);
});

test('broken / missing cards', () => {
  assert.equal(sanitizeChatCard({ messageId: 'x', kind: 'event' }), null);
  assert.deepEqual(sanitizeChatCard({ messageId: M, kind: 'serve', missing: true }), { messageId: M, kind: 'serve', missing: true });
  assert.equal(sanitizeChatCard({ messageId: M, kind: 'poll' }), null);
});

test('picker options drop bad ids', () => {
  const o = sanitizeCardOptions({ events: [{ id: E, title: 'A' }, { id: 'bad', title: 'B' }], serve: [] });
  assert.equal(o.events.length, 1);
});

test('card routes reach the Vault; Serve sign-ups go to Connect', () => {
  for (const sub of ['cards', 'card-options', 'card-create', 'card-going']) {
    assert.match(buildVaultCommunityChatSubUrl('https://vault.example.com', sub), new RegExp(`subResource=${sub}$`));
  }
  const bridge = readFileSync(new URL('../api/community-chat.js', import.meta.url), 'utf8');
  assert.ok(bridge.includes("${connectOrigin}/api/serve"));
});
