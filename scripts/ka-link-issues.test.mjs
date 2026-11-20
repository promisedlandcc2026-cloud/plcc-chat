/**
 * Issues (Account → Issues): who had problems, why, and the fix — leaders only.
 * Run: node --test scripts/ka-link-issues.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeClientIssue, sanitizeIssueRow, shouldReportBridgeFailure } from '../api/_utils/issueReport.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('Ka Link Issues', () => {
  it('reports are tagged as Ka Link and stripped to safe fields', () => {
    const r = sanitizeClientIssue({ area: 'huddle', code: 'huddle_join_stalled', message: 'x'.repeat(500), token: 'secret' });
    assert.equal(r.source, 'ka-link-app');
    assert.equal(r.message.length, 300);
    assert.equal('token' in r, false);
    assert.equal(sanitizeClientIssue({ area: 'nope', code: 'x' }), null);
  });

  it("rows carry Canaan's fix and an opaque person key, never the member id", () => {
    const row = sanitizeIssueRow({ id: '1', at: 'now', code: 'signin_wrong_password', userId: 'abc', fix: 'Reset their password.' });
    assert.equal(row.fix, 'Reset their password.');
    assert.match(row.who, /^[0-9a-f]{12}$/);
    assert.equal('userId' in row, false);
  });

  it('only real failures are reported from the bridge', () => {
    assert.equal(shouldReportBridgeFailure('messages', 502), true);
    assert.equal(shouldReportBridgeFailure('messages', 401), false);
    assert.equal(shouldReportBridgeFailure('issues', 500), false);
  });

  it('wired: bridge, menu link for leaders, page route, crash reporter, call events', () => {
    const bridge = read('api/community-chat.js');
    assert.match(bridge, /resource === 'issue-report'/);
    assert.match(bridge, /resource === 'issues'/);
    assert.match(read('api/_utils/vaultOrigin.js'), /'issue-report',\s*'issues'/);
    assert.match(read('components/chat/AccountMenu.tsx'), /canViewIssues\(\)[\s\S]*navigate\('\/issues'\)/);
    assert.match(read('App.tsx'), /path="\/issues"/);
    assert.match(read('index.tsx'), /installCrashReporter\(\)/);
    const call = read('components/community/ConnectVoiceHuddle.tsx');
    for (const code of ['huddle_joined', 'huddle_left', 'huddle_dropped', 'huddle_join_stalled', 'huddle_app_closed', 'huddle_other_device']) {
      assert.ok(call.includes(`'${code}'`), code);
    }
  });

  it('explanations say Ka Link, include sign-in advice and the stuck-rejoin fix', () => {
    const d = read('lib/issuesDiagnosis.ts');
    assert.ok(!/AWC/.test(d));
    assert.match(d, /signin_/);
    assert.match(d, /huddle_join_stalled/);
    assert.ok(!/AWC/.test(read('pages/IssuesPage.tsx')));
  });
});
