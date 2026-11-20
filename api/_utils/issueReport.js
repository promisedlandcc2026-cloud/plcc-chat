/**
 * Issues log (PLCC Ka Link → Account → Issues), kept on Canaan.
 *
 * The bridge reports failures members actually hit to the Vault
 * (community/issue-report → audit_logs). Only an error code, status, room id and
 * the screen — never message text, tokens or call content.
 */

import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which bridge area a resource belongs to. */
export function issueAreaForResource(resource) {
  const r = String(resource || '');
  if (r.startsWith('huddle')) return 'huddle';
  if (r === 'messages' || r === 'room-info' || r === 'unread' || r === 'channels') return 'room';
  if (r.startsWith('attachment')) return 'media';
  return 'other';
}

/**
 * Should the bridge log this failed response?
 * - Never: 401 (sign-in expired is normal), 400/405/413/415 (bad input), the issue
 *   routes themselves (no loops).
 * - huddle-token 403/503: the Vault already logs those with the real reason.
 * - Always: 429, any 5xx / 502 (Vault slow or down).
 * - 403/404 when opening a room or its messages (someone couldn't get in).
 */
export function shouldReportBridgeFailure(resource, status, code) {
  const r = String(resource || '');
  const s = Number(status) || 0;
  if (!s || s < 400) return false;
  if (r === 'issue-report' || r === 'issues') return false;
  // Moderator buttons: every refusal is worth seeing (incl. 400 'not valid').
  if (r === 'huddle-moderate' && s >= 400 && s !== 401) return true;
  if (s === 401 || s === 400 || s === 405 || s === 413 || s === 415) return false;
  if (r === 'huddle-token' && (s === 403 || s === 503) && code !== 'rate_limited') return false;
  if (r === 'huddle-can-start' && s === 403) return false;
  // Minutes permission denials are expected for ordinary members — not a join failure.
  if (r === 'huddle-minutes' && (s === 403 || code === 'minutes_forbidden' || code === 'forbidden')) return false;
  // Attendance and recording are leader-only; the huddle checks quietly whether to show
  // those buttons, so a 403 for an ordinary member is expected — not a join failure.
  if ((r === 'huddle-attendance' || r === 'huddle-recording') && s === 403) return false;
  if (s === 429 || s >= 500) return true;
  if ((s === 403 || s === 404) && (r === 'messages' || r === 'room-info' || r.startsWith('huddle'))) return true;
  return false;
}

/** Map a bridge failure to a stable issue code. */
export function bridgeIssueCode(resource, status, code) {
  const c = String(code || '');
  const area = issueAreaForResource(resource);
  const r = String(resource || '');
  if (c === 'upstream_timeout' || c === 'vault_unreachable' || c === 'rate_limited') return c;
  if (c === 'minutes_forbidden' || (r === 'huddle-minutes' && (status === 403 || c === 'forbidden'))) {
    return 'minutes_forbidden';
  }
  if (c === 'invalid_upstream') return area === 'huddle' ? 'huddle_token_failed' : 'vault_bad_answer';
  if (status === 404) return area === 'huddle' ? 'huddle_forbidden' : 'room_not_found';
  if (status === 403) return area === 'huddle' ? 'huddle_forbidden' : 'room_forbidden';
  if (area === 'room') return 'room_load_failed';
  if (area === 'media') return 'upload_failed';
  if (area === 'huddle') return 'huddle_token_failed';
  return /^[a-z0-9_.:-]{1,64}$/i.test(c) ? c : 'vault_unavailable';
}

/** Room id from the query string or JSON body, if it looks like one. */
export function issueChannelId(req) {
  const q = req && req.query ? req.query : {};
  let b = req ? req.body : null;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      b = null;
    }
  }
  const raw = String(q.channelId || q.channel_id || (b && (b.channelId || b.channel_id)) || '').trim();
  return UUID_RE.test(raw) ? raw : null;
}

/**
 * The few structured huddle details a report may carry (time on call, why it
 * dropped, keep-awake, network, battery). Anything else is dropped.
 */
export function sanitizeIssueExtra(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  const int = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : undefined;
  };
  if (raw.line === 'livekit' || raw.line === 'daily') out.line = raw.line;
  const pairs = [
    ['durationSec', 172800],
    ['outageSec', 86400],
    ['attempt', 100],
    ['battery', 100],
  ];
  for (const [k, max] of pairs) {
    const v = int(raw[k], max);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ['keepAwake', 'hidden', 'charging']) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  const reason = String(raw.reason ?? '').trim();
  if (/^[A-Za-z0-9_.:-]{1,40}$/.test(reason)) out.reason = reason;
  const net = String(raw.net ?? '').trim().toLowerCase();
  if (/^[a-z0-9-]{1,20}$/.test(net)) out.net = net;
  return Object.keys(out).length ? out : null;
}

/** Client report → the only fields the Vault accepts. */
export function sanitizeClientIssue(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const area = String(raw.area || '');
  if (!['huddle', 'room', 'messages', 'signin', 'media', 'app', 'other'].includes(area)) return null;
  const code = String(raw.code || '').trim();
  if (!/^[a-z0-9_.:-]{1,64}$/i.test(code)) return null;
  const clip = (v, n) => (v == null ? null : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) || null);
  const status = Number(raw.status);
  const cid = String(raw.channelId || '').trim();
  return {
    area,
    code,
    source: 'ka-link-app',
    status: Number.isInteger(status) && status >= 0 && status < 1000 ? status : null,
    message: clip(raw.message, 300),
    channelId: UUID_RE.test(cid) ? cid : null,
    path: clip(raw.path, 200),
    device: clip(raw.device, 200),
    extra: sanitizeIssueExtra(raw.extra),
  };
}

/** One row from the Vault's owner view → what the Issues page shows. */
export function sanitizeIssueRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = (v, n = 300) => (v == null ? null : String(v).slice(0, n));
  return {
    id: s(raw.id, 64),
    at: s(raw.at, 40),
    kind: raw.kind === 'activity' ? 'activity' : 'problem',
    severity: ['info', 'warning', 'critical'].includes(raw.severity) ? raw.severity : 'warning',
    area: s(raw.area, 20) || 'other',
    code: s(raw.code, 80) || '',
    title: s(raw.title, 200) || '',
    message: s(raw.message),
    status: typeof raw.status === 'number' ? raw.status : null,
    source: s(raw.source, 20),
    path: s(raw.path, 200),
    device: s(raw.device, 200),
    userName: s(raw.userName, 120),
    channelId: s(raw.channelId, 64),
    channelName: s(raw.channelName, 120),
    // Opaque per-person key so the Issues page can group people with the same name,
    // without sending member ids to the phone.
    who: raw.userId ? createHash('sha256').update(`plcc-issues:${String(raw.userId)}`).digest('hex').slice(0, 12) : null,
    extra: sanitizeIssueExtra(raw.extra),
    fix: s(raw.fix),
  };
}
