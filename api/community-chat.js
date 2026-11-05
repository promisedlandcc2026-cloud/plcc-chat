import { createHash } from 'node:crypto';
import { parseBearerAuthorization } from './_utils/memberIdentity.js';
import {
  MAX_CHAT_BODY_BYTES,
  parseChatMessagesListQuery,
  parseChatUnreadQuery,
  parseDirectoryQuery,
  parseHuddleEndCommand,
  parseHuddleStatusQuery,
  parseHuddleTokenCommand,
  parseMarkChatReadCommand,
  parseOpenDmCommand,
  parseReportMessageCommand,
  parseSendChatMessageCommand,
  parseVaultChatChannelsResponse,
  parseVaultChatMessageMutationResponse,
  parseVaultChatMessagesResponse,
  parseVaultChatUnreadResponse,
  parseVaultDirectoryResponse,
  parseVaultDmChannelResponse,
  parseVaultHuddleEndResponse,
  parseVaultHuddleStatusesResponse,
  parseVaultHuddleTokenResponse,
  parseHuddleFallbackCommand,
  parseHuddleLineCommand,
  parseVaultDailyTokenResponse,
  parseVaultHuddleLineResponse,
  parseAttachmentUploadCommand,
  parseAttachmentConfirmCommand,
  parseVaultUploadUrlResponse,
  sanitizeChatAttachment,
  UUID_RE,
  parseReactionCommand,
  parseEditMessageCommand,
  parseVaultReadReceipts,
  parseVaultMentionCandidates,
  sanitizePinned,
  sanitizePoll,
  sanitizeChatCard,
  sanitizeChatRequest,
  sanitizeCardOptions,
  sanitizeSearchResults,
  sanitizePeople,
  parseGroupCreateCommand,
  sanitizeChatChannel,
  sanitizeDmList,
  sanitizeArchives,
} from './_utils/communityChatSanitize.js';
import {
  buildVaultCommunityChatChannelsUrl,
  buildVaultCommunityChatDmChannelUrl,
  buildVaultCommunityChatHuddleStatusesUrl,
  buildVaultCommunityChatMarkReadUrl,
  buildVaultCommunityChatMentorsUrl,
  buildVaultCommunityChatMessagesUrl,
  buildVaultCommunityChatUnreadUrl,
  buildVaultCommunityChatVoiceEndUrl,
  buildVaultCommunityChatVoiceTokenUrl,
  buildVaultCommunityChatVoiceCanStartUrl,
  buildVaultCommunityChatAttachmentUrl,
  buildVaultCommunityChatDeleteMessageUrl,
  buildVaultCommunityChatRoomUrl,
  buildVaultCommunityChatSubUrl,
  parseVaultApiOrigin,
  buildVaultHuddleFailsafeUrl,
} from './_utils/vaultOrigin.js';

/**
 * Single serverless function for Connect chat bridges (Hobby function-count limit).
 *
 * GET  /api/community-chat?resource=channels
 * GET  /api/community-chat?resource=messages&channelId=
 * POST /api/community-chat?resource=messages   { channelId, content }
 * GET  /api/community-chat?resource=unread
 * POST /api/community-chat?resource=unread     { channelId }  (mark-read)
 * GET  /api/community-chat?resource=huddle-status&channelIds=
 * POST /api/community-chat?resource=huddle-token  { channelId }
 * POST /api/community-chat?resource=huddle-end    { channelId }
 * GET  /api/community-chat?resource=directory&q=
 * POST /api/community-chat?resource=dm            { partnerId }
 */

const UPSTREAM_TIMEOUT_MS = 15000;
const TOKEN_UPSTREAM_TIMEOUT_MS = 20000;
const ALLOWED_RESOURCES = new Set([
  'channels',
  'messages',
  'unread',
  'huddle-status',
  'huddle-token',
  'huddle-end',
  'huddle-token-fallback',
  'huddle-line',
  'huddle-daily-token',
  'huddle-can-start',
  'attachment-upload-url',
  'attachment-confirm',
  'message-delete',
  'message-report',
  'room-info',
  'reaction',
  'message-edit',
  'read-receipts',
  'mentions',
  'pin',
  'room-settings',
  'search',
  'group-create',
  'group-members',
  'group-member-add',
  'group-member-remove',
  'people',
  'ministries',
  'dm-list',
  'archives',
  'room-archive',
  'room-mute',
  'directory',
  'dm',
  'polls',
  'poll-create',
  'poll-vote',
  'poll-close',
  'cards',
  'card-options',
  'card-create',
  'card-going',
  'serve-signup',
  'requests',
  'request-create',
  'request-update',
]);

/** Soft per-identity rate limit for token mints (serverless-local Map). */
const TOKEN_RATE_WINDOW_MS = 60_000;
const TOKEN_RATE_MAX = 8;
/** @type {Map<string, number[]>} */
const tokenRateBuckets = new Map();

function setPrivateNoStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
}

function json(res, status, body) {
  setPrivateNoStore(res);
  res.status(status).json(body);
}

/** PLCC Connect (Serve sign-ups). Fixed server-side; never from the browser. */
function connectApiOrigin() {
  const raw = String(process.env.CONNECT_API_ORIGIN || 'https://plcc-connect.vercel.app').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+$/i.test(raw) ? raw : null;
}

/** Vault refused to START a huddle (member may join once a leader/moderator starts it). */
const HUDDLE_NOT_STARTED_MESSAGE =
  "This huddle hasn't started yet. A leader or room moderator will start it — you can join as soon as it's live.";

function isHuddleStartForbidden(status, body) {
  return status === 403 && body && typeof body === 'object' && body.code === 'huddle_start_forbidden';
}

function huddleNotStarted(res) {
  return json(res, 403, { ok: false, code: 'huddle_not_started', message: HUDDLE_NOT_STARTED_MESSAGE });
}

function mapUpstreamError(res, status, forbiddenMessage) {
  if (status === 401) {
    return json(res, 401, {
      ok: false,
      code: 'unauthorized',
      message: 'Please sign in again to continue.',
    });
  }
  if (status === 403) {
    return json(res, 403, {
      ok: false,
      code: 'forbidden',
      message: forbiddenMessage || 'You do not have access to this chat.',
    });
  }
  if (status === 404) {
    return json(res, 404, {
      ok: false,
      code: 'not_found',
      message: 'That channel could not be found.',
    });
  }
  if (status === 429) {
    return json(res, 429, {
      ok: false,
      code: 'rate_limited',
      message: 'Too many requests. Please wait a moment and try again.',
    });
  }
  if (status === 400) {
    return json(res, 400, {
      ok: false,
      code: 'invalid_body',
      message: 'Please check your message and try again.',
    });
  }
  if (status === 503) {
    return json(res, 503, {
      ok: false,
      code: 'huddle_unavailable',
      message: 'Live Huddle is not available right now. Please try again later.',
    });
  }
  console.error('[community-chat] upstream status', status);
  return json(res, 502, {
    ok: false,
    code: 'vault_unavailable',
    message: 'Chat is temporarily unavailable. Please try again.',
  });
}

function parseJsonBody(req) {
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return { ok: false, status: 415, code: 'invalid_content_type' };
  }
  let rawBody = req.body;
  if (typeof rawBody === 'string') {
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_CHAT_BODY_BYTES) {
      return { ok: false, status: 413, code: 'body_too_large' };
    }
    try {
      rawBody = JSON.parse(rawBody);
    } catch {
      return { ok: false, status: 400, code: 'invalid_json' };
    }
  }
  if (rawBody == null) {
    return { ok: false, status: 400, code: 'empty_body' };
  }
  return { ok: true, body: rawBody };
}

/**
 * @param {Record<string, unknown>} query
 */
function parseResource(query) {
  const q = query && typeof query === 'object' ? query : {};
  const raw = q.resource;
  if (Array.isArray(raw)) return { ok: false, reason: 'duplicate_resource' };
  const resource = typeof raw === 'string' ? raw.trim() : '';
  if (!ALLOWED_RESOURCES.has(resource)) return { ok: false, reason: 'invalid_resource' };
  return { ok: true, resource, query: q };
}

/**
 * @param {string} bearerToken
 * @returns {boolean}
 */
function allowHuddleTokenMint(bearerToken) {
  const key = createHash('sha256').update(String(bearerToken || '')).digest('hex').slice(0, 32);
  const now = Date.now();
  let stamps = tokenRateBuckets.get(key) || [];
  stamps = stamps.filter((t) => now - t < TOKEN_RATE_WINDOW_MS);
  if (stamps.length >= TOKEN_RATE_MAX) {
    tokenRateBuckets.set(key, stamps);
    return false;
  }
  stamps.push(now);
  tokenRateBuckets.set(key, stamps);
  return true;
}

/**
 * POST /api/community-chat?resource=huddle-token-fallback { channelId, fallbackPass }
 * → Vault voice-token-fallback (no Supabase on Vault). Bearer optional.
 */
async function handleHuddleTokenFallback(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
  }
  const parsedBody = parseJsonBody(req);
  if (!parsedBody.ok) {
    return json(res, parsedBody.status, { ok: false, code: parsedBody.code, message: 'Please try again.' });
  }
  const command = parseHuddleFallbackCommand(parsedBody.body);
  if (!command.ok) {
    return json(res, 400, { ok: false, code: 'invalid_body', message: 'That huddle request was not valid.' });
  }
  if (!allowHuddleTokenMint(`fallback:${command.fallbackPass}`)) {
    return json(res, 429, { ok: false, code: 'rate_limited', message: 'Too many huddle join attempts. Please wait a moment and try again.' });
  }
  const allowHttpLocal = process.env.NODE_ENV !== 'production';
  const originResult = parseVaultApiOrigin(process.env.VAULT_API_ORIGIN, { allowHttpLocal });
  if (!originResult.ok) {
    return json(res, 503, { ok: false, code: 'bridge_unconfigured', message: 'Live Huddle is not available right now.' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(buildVaultHuddleFailsafeUrl(originResult.origin, 'fallback'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: command.channelId, fallbackPass: command.fallbackPass }),
      signal: controller.signal,
      redirect: 'error',
    });
    let body = null;
    try {
      body = await upstream.json();
    } catch {
      body = null;
    }
    if (isHuddleStartForbidden(upstream.status, body)) return huddleNotStarted(res);
    if (!upstream.ok) {
      return json(res, upstream.status === 401 ? 401 : 502, {
        ok: false,
        code: upstream.status === 401 ? 'fallback_expired' : 'vault_unavailable',
        message:
          upstream.status === 401
            ? 'Saved huddle permission expired. Try again after the church database is back.'
            : 'Could not open the huddle while the church database is down.',
      });
    }
    const parsed = parseVaultHuddleTokenResponse(body);
    if (!parsed.ok) {
      return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not open the huddle while the church database is down.' });
    }
    return json(res, 200, { ok: true, ...parsed.token, fallback: true });
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    console.error('[community-chat] huddle fallback', aborted ? 'timeout' : 'network');
    return json(res, 502, { ok: false, code: 'vault_unavailable', message: 'Could not open the huddle while the church database is down.' });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  setPrivateNoStore(res);

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, {
      ok: false,
      code: 'method_not_allowed',
      message: 'This endpoint only supports GET and POST.',
    });
  }

  // Database-down fail-safe: the Vault-signed pass is the credential, so this
  // route must work even when the member's session can't be refreshed.
  if (String(req.query?.resource || '') === 'huddle-token-fallback') {
    return handleHuddleTokenFallback(req, res);
  }

  const auth = parseBearerAuthorization(req.headers?.authorization);
  if (!auth.ok) {
    return json(res, 401, {
      ok: false,
      code: 'unauthorized',
      message: 'Please sign in again to continue.',
    });
  }

  const resourceResult = parseResource(req.query || {});
  if (!resourceResult.ok) {
    return json(res, 400, {
      ok: false,
      code: 'invalid_query',
      message: 'That chat request was not valid. Please try again.',
    });
  }

  const allowHttpLocal = process.env.NODE_ENV !== 'production';
  const originResult = parseVaultApiOrigin(process.env.VAULT_API_ORIGIN, {
    allowHttpLocal,
  });
  if (!originResult.ok) {
    console.error('[community-chat] VAULT_API_ORIGIN invalid:', originResult.reason);
    return json(res, 503, {
      ok: false,
      code: 'bridge_unconfigured',
      message: 'Chat is not available right now. Please try again later.',
    });
  }

  const { resource, query } = resourceResult;
  const timeoutMs =
    resource === 'huddle-token' || resource === 'huddle-end' || resource === 'huddle-daily-token'
      ? TOKEN_UPSTREAM_TIMEOUT_MS
      : UPSTREAM_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (resource === 'channels') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, {
          ok: false,
          code: 'method_not_allowed',
          message: 'Channels only supports GET.',
        });
      }
      const extras = Object.keys(query).filter((k) => k !== 'resource');
      if (extras.length > 0) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_query',
          message: 'That chat request was not valid. Please try again.',
        });
      }

      const upstream = await fetch(buildVaultCommunityChatChannelsUrl(originResult.origin), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        return mapUpstreamError(res, upstream.status, 'Chat is not available for this account yet.');
      }
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultChatChannelsResponse(body);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      return json(res, 200, {
        ok: true,
        channels: parsed.channels,
        skipped: parsed.skipped,
      });
    }

    if (resource === 'messages') {
      if (req.method === 'GET') {
        const { resource: _r, ...rest } = query;
        const page = parseChatMessagesListQuery(rest);
        if (!page.ok) {
          return json(res, 400, {
            ok: false,
            code: 'invalid_query',
            message: 'That chat request was not valid. Please try again.',
          });
        }
        const upstream = await fetch(
          buildVaultCommunityChatMessagesUrl(originResult.origin, page.channelId),
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${auth.token}`,
            },
            signal: controller.signal,
            redirect: 'error',
          }
        );
        if (!upstream.ok) return mapUpstreamError(res, upstream.status);
        let body;
        try {
          body = await upstream.json();
        } catch {
          return json(res, 502, {
            ok: false,
            code: 'invalid_upstream',
            message: 'Chat is temporarily unavailable. Please try again.',
          });
        }
        const parsed = parseVaultChatMessagesResponse(body);
        if (!parsed.ok) {
          return json(res, 502, {
            ok: false,
            code: 'invalid_upstream',
            message: 'Chat is temporarily unavailable. Please try again.',
          });
        }
        return json(res, 200, {
          ok: true,
          channelId: page.channelId,
          messages: parsed.messages,
          skipped: parsed.skipped,
          truncated: parsed.truncated,
        });
      }

      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, {
          ok: false,
          code: parsedBody.code,
          message:
            parsedBody.code === 'body_too_large'
              ? 'That message is too long.'
              : 'Please check your message and try again.',
        });
      }
      const command = parseSendChatMessageCommand(parsedBody.body);
      if (!command.ok) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_body',
          message:
            command.reason === 'too_long'
              ? 'That message is too long.'
              : 'Please check your message and try again.',
        });
      }
      const upstream = await fetch(buildVaultCommunityChatMessagesUrl(originResult.origin), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          channelId: command.channelId,
          content: command.content,
          ...(command.parentId ? { parentId: command.parentId } : {}),
          ...(command.mentionedUserIds.length ? { mentionedUserIds: command.mentionedUserIds } : {}),
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultChatMessageMutationResponse(body);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      return json(res, 200, { ok: true, message: parsed.message });
    }

    if (resource === 'huddle-status') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, {
          ok: false,
          code: 'method_not_allowed',
          message: 'Huddle status only supports GET.',
        });
      }
      const { resource: _r, ...rest } = query;
      const page = parseHuddleStatusQuery(rest);
      if (!page.ok) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_query',
          message: 'That huddle request was not valid. Please try again.',
        });
      }
      const upstream = await fetch(
        buildVaultCommunityChatHuddleStatusesUrl(
          originResult.origin,
          page.channelIds.join(',')
        ),
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          signal: controller.signal,
          redirect: 'error',
        }
      );
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultHuddleStatusesResponse(body, page.channelIds);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      return json(res, 200, { ok: true, byChannel: parsed.byChannel });
    }

    if (
      resource === 'pin' ||
      resource === 'poll-create' ||
      resource === 'poll-vote' ||
      resource === 'poll-close' ||
      resource === 'card-create' ||
      resource === 'card-going' ||
      resource === 'serve-signup' ||
      resource === 'request-create' ||
      resource === 'request-update' ||
      resource === 'room-settings' ||
      resource === 'search' ||
      resource === 'group-create' ||
      resource === 'group-member-add' ||
      resource === 'group-member-remove'
    ) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      const b =
        parsedBody.ok && parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body)
          ? parsedBody.body
          : null;
      const bad = (message = 'That request was not valid.') => json(res, 400, { ok: false, code: 'invalid_body', message });
      if (!b) return bad();
      const only = (keys) => Object.keys(b).every((k) => keys.includes(k));
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` };
      const call = (sub, method, payload, extraQs = '') =>
        fetch(`${buildVaultCommunityChatSubUrl(originResult.origin, sub)}${extraQs}`, {
          method,
          headers,
          ...(payload ? { body: JSON.stringify(payload) } : {}),
          signal: controller.signal,
          redirect: 'error',
        });
      const fail = async (upstream, fallback) => {
        if (upstream.status === 401) return mapUpstreamError(res, 401);
        const body = await upstream.json().catch(() => null);
        const status = upstream.status === 403 ? 403 : upstream.status === 503 ? 503 : 400;
        return json(res, status, {
          ok: false,
          code: upstream.status === 403 ? 'forbidden' : 'request_failed',
          message: typeof body?.error === 'string' ? body.error.slice(0, 160) : fallback,
        });
      };

      if (resource === 'request-create') {
        if (!only(['messageId', 'category', 'details']) || !UUID_RE.test(String(b.messageId || ''))) return bad();
        if (!['ride', 'visit', 'meal', 'errand', 'other'].includes(String(b.category)) || typeof b.details !== 'string') return bad();
        const upstream = await call('request-create', 'POST', { messageId: b.messageId, category: b.category, details: b.details.slice(0, 1000) });
        if (!upstream.ok) return fail(upstream, 'Could not send that request.');
        const body = await upstream.json().catch(() => null);
        const request = sanitizeChatRequest(body?.request);
        if (!request) return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not send that request.' });
        return json(res, 200, { ok: true, request });
      }
      if (resource === 'request-update') {
        if (!only(['requestId', 'action', 'assigneeId', 'note']) || !UUID_RE.test(String(b.requestId || ''))) return bad();
        if (!['volunteer', 'assign', 'unassign', 'done', 'reopen', 'cancel', 'note'].includes(String(b.action))) return bad();
        const payload = { requestId: b.requestId, action: b.action };
        if (b.action === 'assign') {
          if (!UUID_RE.test(String(b.assigneeId || ''))) return bad();
          payload.assigneeId = b.assigneeId;
        }
        if (typeof b.note === 'string' && b.note.trim()) payload.note = b.note.slice(0, 500);
        const upstream = await call('request-update', 'POST', payload);
        if (upstream.status === 409) {
          const body = await upstream.json().catch(() => null);
          return json(res, 409, { ok: false, code: 'conflict', message: typeof body?.error === 'string' ? body.error.slice(0, 160) : 'Someone just changed this request.' });
        }
        if (!upstream.ok) return fail(upstream, 'Could not update that request.');
        const body = await upstream.json().catch(() => null);
        const request = sanitizeChatRequest(body?.request);
        if (!request) return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not update that request.' });
        return json(res, 200, { ok: true, request });
      }
      if (resource === 'card-create') {
        if (!only(['messageId', 'kind', 'refId']) || !UUID_RE.test(String(b.messageId || '')) || !UUID_RE.test(String(b.refId || ''))) return bad();
        if (b.kind !== 'event' && b.kind !== 'serve') return bad();
        const upstream = await call('card-create', 'POST', { messageId: b.messageId, kind: b.kind, refId: b.refId });
        if (!upstream.ok) return fail(upstream, 'Could not share that.');
        return json(res, 200, { ok: true });
      }
      if (resource === 'card-going') {
        if (!only(['eventId', 'going', 'messageId']) || !UUID_RE.test(String(b.eventId || '')) || typeof b.going !== 'boolean') return bad();
        const payload = { eventId: b.eventId, going: b.going };
        if (UUID_RE.test(String(b.messageId || ''))) payload.messageId = b.messageId;
        const upstream = await call('card-going', 'POST', payload);
        if (!upstream.ok) return fail(upstream, 'Could not save that.');
        const body = await upstream.json().catch(() => null);
        return json(res, 200, { ok: true, going: body?.going === true, goingCount: Math.max(0, Math.floor(Number(body?.goingCount) || 0)) });
      }
      if (resource === 'serve-signup') {
        // Serve sign-up runs through PLCC Connect's Serve API (staff-verified eligibility + RPC).
        if (!only(['opportunityId', 'action']) || !UUID_RE.test(String(b.opportunityId || ''))) return bad();
        if (b.action !== 'signup' && b.action !== 'cancel') return bad();
        const connectOrigin = connectApiOrigin();
        if (!connectOrigin) return json(res, 503, { ok: false, code: 'serve_unavailable', message: 'Serve is not available right now.' });
        const upstream = await fetch(`${connectOrigin}/api/serve`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: b.action, opportunityId: b.opportunityId }),
          signal: controller.signal,
          redirect: 'error',
        });
        const body = await upstream.json().catch(() => null);
        if (upstream.status === 401) return mapUpstreamError(res, 401);
        if (!upstream.ok || body?.ok !== true) {
          return json(res, upstream.status === 403 ? 403 : 400, {
            ok: false,
            code: typeof body?.code === 'string' ? body.code.slice(0, 40) : 'serve_failed',
            message: typeof body?.message === 'string' ? body.message.slice(0, 200) : 'Could not save that. Please try again.',
          });
        }
        return json(res, 200, { ok: true, action: b.action });
      }
      if (resource === 'poll-create') {
        if (!only(['messageId', 'question', 'options', 'multi', 'anonymous']) || !UUID_RE.test(String(b.messageId || ''))) return bad();
        if (typeof b.question !== 'string' || !Array.isArray(b.options) || b.options.length > 10) return bad();
        const options = b.options.map((o) => String(o ?? '').slice(0, 100));
        const upstream = await call('poll-create', 'POST', {
          messageId: b.messageId,
          question: b.question.slice(0, 300),
          options,
          multi: b.multi === true,
          anonymous: b.anonymous === true,
        });
        if (!upstream.ok) return fail(upstream, 'Could not start that poll.');
        const body = await upstream.json().catch(() => null);
        const poll = sanitizePoll(body?.poll);
        if (!poll) return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not start that poll.' });
        return json(res, 200, { ok: true, poll });
      }
      if (resource === 'poll-vote') {
        if (!only(['pollId', 'optionIds']) || !UUID_RE.test(String(b.pollId || '')) || !Array.isArray(b.optionIds) || b.optionIds.length > 10) return bad();
        const optionIds = b.optionIds.map((x) => String(x)).filter((x) => /^o\d{1,2}$/.test(x));
        const upstream = await call('poll-vote', 'POST', { pollId: b.pollId, optionIds });
        if (!upstream.ok) return fail(upstream, 'Could not save your vote.');
        return json(res, 200, { ok: true, myVotes: optionIds });
      }
      if (resource === 'poll-close') {
        if (!only(['pollId']) || !UUID_RE.test(String(b.pollId || ''))) return bad();
        const upstream = await call('poll-close', 'POST', { pollId: b.pollId });
        if (!upstream.ok) return fail(upstream, 'Could not close that poll.');
        return json(res, 200, { ok: true, closed: true });
      }
      if (resource === 'pin') {
        if (!only(['messageId', 'pinned']) || !UUID_RE.test(String(b.messageId || '')) || typeof b.pinned !== 'boolean') return bad();
        const upstream = await call('pin', 'POST', { messageId: b.messageId, pinned: b.pinned });
        if (!upstream.ok) return fail(upstream, 'Could not pin that message.');
        const body = await upstream.json().catch(() => null);
        return json(res, 200, { ok: true, pinned: sanitizePinned(body?.pinned) });
      }
      if (resource === 'room-settings') {
        if (!only(['channelId', 'announceOnly', 'name', 'description']) || !UUID_RE.test(String(b.channelId || ''))) return bad();
        const payload = { channelId: b.channelId };
        if (typeof b.announceOnly === 'boolean') payload.announceOnly = b.announceOnly;
        if (typeof b.name === 'string') payload.name = b.name.slice(0, 80);
        if (typeof b.description === 'string') payload.description = b.description.slice(0, 300);
        const upstream = await call('room-settings', 'POST', payload);
        if (!upstream.ok) return fail(upstream, 'Could not save the group settings.');
        const body = await upstream.json().catch(() => null);
        return json(res, 200, { ok: true, channel: sanitizeChatChannel(body?.channel) });
      }
      if (resource === 'search') {
        if (!only(['q', 'channelId'])) return bad();
        const q = String(b.q || '').slice(0, 80);
        if (b.channelId != null && !UUID_RE.test(String(b.channelId))) return bad();
        const upstream = await call('search', 'POST', b.channelId ? { q, channelId: b.channelId } : { q });
        if (!upstream.ok) return fail(upstream, 'Search is not available right now.');
        const body = await upstream.json().catch(() => null);
        return json(res, 200, { ok: true, results: sanitizeSearchResults(body?.results) });
      }
      if (resource === 'group-create') {
        const command = parseGroupCreateCommand(b);
        if (!command.ok) {
          return bad(
            command.reason === 'name_required'
              ? 'Give the group a name.'
              : command.reason === 'ministry_required'
                ? 'Pick the ministry for this group.'
                : 'Please check the group details.'
          );
        }
        const upstream = await call('channels', 'POST', {
          name: command.name,
          description: command.description,
          channelType: command.kind,
          ...(command.ministryId ? { ministryId: command.ministryId } : {}),
          memberIds: command.memberIds,
        });
        if (!upstream.ok) return fail(upstream, 'Could not create the group.');
        const created = sanitizeChatChannel(await upstream.json().catch(() => null));
        if (!created) return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not create the group.' });
        if (command.announceOnly) {
          await call('room-settings', 'POST', { channelId: created.id, announceOnly: true }).catch(() => null);
          created.announceOnly = true;
        }
        return json(res, 200, { ok: true, channel: created });
      }
      // group-member-add / group-member-remove
      if (!UUID_RE.test(String(b.channelId || ''))) return bad();
      if (resource === 'group-member-add') {
        const ids = Array.isArray(b.userIds) ? [...new Set(b.userIds.map((x) => String(x || '')))] : [];
        if (!only(['channelId', 'userIds']) || !ids.length || ids.length > 100 || ids.some((id) => !UUID_RE.test(id))) return bad();
        const upstream = await call('channel-members', 'POST', { channelId: b.channelId, userIds: ids });
        if (!upstream.ok) return fail(upstream, 'Could not add those people.');
        const body = await upstream.json().catch(() => null);
        return json(res, 200, { ok: true, members: sanitizePeople(body?.members) });
      }
      if (!only(['channelId', 'userId']) || !UUID_RE.test(String(b.userId || ''))) return bad();
      const upstream = await call(
        'channel-members',
        'DELETE',
        null,
        `&channelId=${encodeURIComponent(b.channelId)}&userId=${encodeURIComponent(b.userId)}`
      );
      if (!upstream.ok) return fail(upstream, 'Could not remove that person.');
      return json(res, 200, { ok: true });
    }

    if (resource === 'archives') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only GET is supported.' });
      }
      const upstream = await fetch(buildVaultCommunityChatSubUrl(originResult.origin, 'archives'), {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      return json(res, 200, { ok: true, archived: sanitizeArchives(await upstream.json().catch(() => null)) });
    }

    if (resource === 'room-archive') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      const b = parsedBody.ok && parsedBody.body && typeof parsedBody.body === 'object' ? parsedBody.body : null;
      if (
        !b ||
        !UUID_RE.test(String(b.channelId || '')) ||
        typeof b.archived !== 'boolean' ||
        Object.keys(b).some((k) => k !== 'channelId' && k !== 'archived')
      ) {
        return json(res, 400, { ok: false, code: 'invalid_body', message: 'That request was not valid.' });
      }
      const upstream = await fetch(buildVaultCommunityChatSubUrl(originResult.origin, 'room-archive'), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ channelId: b.channelId, archived: b.archived }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        const body = await upstream.json().catch(() => null);
        if (upstream.status === 503 && typeof body?.error === 'string') {
          return json(res, 503, { ok: false, code: 'not_set_up', message: body.error.slice(0, 160) });
        }
        return mapUpstreamError(res, upstream.status);
      }
      return json(res, 200, { ok: true, channelId: b.channelId, archived: b.archived });
    }

    if (resource === 'dm-list') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only GET is supported.' });
      }
      const upstream = await fetch(buildVaultCommunityChatSubUrl(originResult.origin, 'dm-list'), {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      return json(res, 200, { ok: true, conversations: sanitizeDmList(await upstream.json().catch(() => null)) });
    }

    if (resource === 'group-members' || resource === 'people' || resource === 'ministries') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only GET is supported.' });
      }
      const cid = query.channelId ? String(query.channelId) : '';
      if (cid && !UUID_RE.test(cid)) {
        return json(res, 400, { ok: false, code: 'invalid_query', message: 'That request was not valid.' });
      }
      let url;
      if (resource === 'group-members') {
        if (!cid) return json(res, 400, { ok: false, code: 'invalid_query', message: 'That request was not valid.' });
        url = `${buildVaultCommunityChatSubUrl(originResult.origin, 'channel-members')}&channelId=${encodeURIComponent(cid)}`;
      } else if (resource === 'people') {
        const q = String(query.q || '').slice(0, 40);
        url = `${buildVaultCommunityChatSubUrl(originResult.origin, 'member-picker')}&q=${encodeURIComponent(q)}${cid ? `&channelId=${encodeURIComponent(cid)}` : ''}`;
      } else {
        url = buildVaultCommunityChatSubUrl(originResult.origin, 'chat-ministries');
      }
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status, 'Only group admins can see this.');
      const body = await upstream.json().catch(() => null);
      if (resource === 'ministries') {
        const list = Array.isArray(body?.ministries) ? body.ministries : [];
        return json(res, 200, {
          ok: true,
          ministries: list
            .filter((m) => UUID_RE.test(String(m?.id || '')))
            .slice(0, 200)
            .map((m) => ({ id: String(m.id), name: String(m.name || 'Ministry').slice(0, 80) })),
        });
      }
      return json(res, 200, { ok: true, people: sanitizePeople(body) });
    }

    if (resource === 'mentions') {
      // GET ?resource=mentions&channelId=&q=  → people in this room to @mention
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only GET is supported.' });
      }
      const cid = String(query.channelId || '');
      const q = String(query.q || '').slice(0, 40);
      if (!UUID_RE.test(cid) || Object.keys(query).some((k) => !['resource', 'channelId', 'q'].includes(k))) {
        return json(res, 400, { ok: false, code: 'invalid_query', message: 'That request was not valid.' });
      }
      const url = `${buildVaultCommunityChatSubUrl(originResult.origin, 'mention-candidates')}&channelId=${encodeURIComponent(cid)}&q=${encodeURIComponent(q)}`;
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      const parsed = parseVaultMentionCandidates(await upstream.json().catch(() => null));
      if (!parsed.ok) return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not load names.' });
      return json(res, 200, { ok: true, people: parsed.people });
    }

    if (resource === 'requests') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only GET is supported.' });
      }
      let qs = '';
      const cid = String(req.query?.channelId || '').trim();
      if (UUID_RE.test(cid)) {
        qs = `&channelId=${encodeURIComponent(cid)}&scope=${req.query?.scope === 'all' ? 'all' : 'open'}`;
      } else {
        const ids = String(req.query?.messageIds || '')
          .split(',')
          .map((x) => x.trim())
          .filter((x) => UUID_RE.test(x))
          .slice(0, 100);
        if (!ids.length) return json(res, 200, { ok: true, requests: [] });
        qs = `&messageIds=${encodeURIComponent(ids.join(','))}`;
      }
      const upstream = await fetch(`${buildVaultCommunityChatSubUrl(originResult.origin, 'requests')}${qs}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      const body = await upstream.json().catch(() => null);
      return json(res, 200, { ok: true, requests: (Array.isArray(body?.requests) ? body.requests : []).map(sanitizeChatRequest).filter(Boolean) });
    }

    if (resource === 'cards' || resource === 'card-options') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only GET is supported.' });
      }
      let qs = '';
      if (resource === 'cards') {
        const ids = String(req.query?.messageIds || '')
          .split(',')
          .map((x) => x.trim())
          .filter((x) => UUID_RE.test(x))
          .slice(0, 100);
        if (!ids.length) return json(res, 200, { ok: true, cards: [] });
        qs = `&messageIds=${encodeURIComponent(ids.join(','))}`;
      }
      const upstream = await fetch(`${buildVaultCommunityChatSubUrl(originResult.origin, resource)}${qs}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      const body = await upstream.json().catch(() => null);
      if (resource === 'cards') {
        return json(res, 200, { ok: true, cards: (Array.isArray(body?.cards) ? body.cards : []).map(sanitizeChatCard).filter(Boolean) });
      }
      return json(res, 200, { ok: true, ...sanitizeCardOptions(body) });
    }

    if (resource === 'polls') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only GET is supported.' });
      }
      const ids = String(req.query?.messageIds || '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => UUID_RE.test(x))
        .slice(0, 100);
      if (!ids.length) return json(res, 200, { ok: true, polls: [] });
      const upstream = await fetch(`${buildVaultCommunityChatSubUrl(originResult.origin, 'polls')}&messageIds=${encodeURIComponent(ids.join(','))}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      const body = await upstream.json().catch(() => null);
      const polls = (Array.isArray(body?.polls) ? body.polls : []).map(sanitizePoll).filter(Boolean);
      return json(res, 200, { ok: true, polls });
    }

    if (resource === 'reaction' || resource === 'message-edit' || resource === 'read-receipts') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, { ok: false, code: parsedBody.code, message: 'Please try again.' });
      }
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      };
      if (resource === 'reaction') {
        const command = parseReactionCommand(parsedBody.body);
        if (!command.ok) return json(res, 400, { ok: false, code: 'invalid_body', message: 'That reaction was not valid.' });
        const base = buildVaultCommunityChatSubUrl(originResult.origin, 'reactions');
        const upstream = command.on
          ? await fetch(base, {
              method: 'POST',
              headers,
              body: JSON.stringify({ messageId: command.messageId, emoji: command.emoji }),
              signal: controller.signal,
              redirect: 'error',
            })
          : await fetch(`${base}&messageId=${encodeURIComponent(command.messageId)}&emoji=${encodeURIComponent(command.emoji)}`, {
              method: 'DELETE',
              headers,
              signal: controller.signal,
              redirect: 'error',
            });
        if (!upstream.ok) return mapUpstreamError(res, upstream.status, 'You can’t react in this chat.');
        return json(res, 200, { ok: true, messageId: command.messageId, emoji: command.emoji, on: command.on });
      }
      if (resource === 'message-edit') {
        const command = parseEditMessageCommand(parsedBody.body);
        if (!command.ok) {
          return json(res, 400, {
            ok: false,
            code: 'invalid_body',
            message: command.reason === 'too_long' ? 'That message is too long.' : 'Please check your message and try again.',
          });
        }
        const upstream = await fetch(buildVaultCommunityChatSubUrl(originResult.origin, 'edit-message'), {
          method: 'POST',
          headers,
          body: JSON.stringify({ messageId: command.messageId, content: command.content }),
          signal: controller.signal,
          redirect: 'error',
        });
        const body = await upstream.json().catch(() => null);
        if (!upstream.ok) {
          if (upstream.status === 401) return mapUpstreamError(res, 401);
          return json(res, upstream.status === 403 ? 403 : 400, {
            ok: false,
            code: 'edit_failed',
            message: typeof body?.error === 'string' ? body.error.slice(0, 160) : 'Could not edit that message.',
          });
        }
        const parsed = parseVaultChatMessageMutationResponse(body);
        if (!parsed.ok) return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not edit that message.' });
        return json(res, 200, { ok: true, message: parsed.message });
      }
      // read-receipts
      const b = parsedBody.body;
      if (!b || typeof b !== 'object' || !UUID_RE.test(String(b.channelId || '')) || Object.keys(b).some((k) => k !== 'channelId')) {
        return json(res, 400, { ok: false, code: 'invalid_body', message: 'That request was not valid.' });
      }
      const upstream = await fetch(buildVaultCommunityChatSubUrl(originResult.origin, 'read-receipts'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ channelId: b.channelId }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      const parsed = parseVaultReadReceipts(await upstream.json().catch(() => null));
      if (!parsed.ok) return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not load read receipts.' });
      return json(res, 200, { ok: true, readers: parsed.readers });
    }

    if (resource === 'room-info' || resource === 'room-mute') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      const b = parsedBody.ok && parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body)
        ? parsedBody.body
        : null;
      const allowed = resource === 'room-mute' ? ['channelId', 'muted'] : ['channelId'];
      if (
        !b ||
        !UUID_RE.test(String(b.channelId || '')) ||
        Object.keys(b).some((k) => !allowed.includes(k)) ||
        (resource === 'room-mute' && typeof b.muted !== 'boolean')
      ) {
        return json(res, 400, { ok: false, code: 'invalid_body', message: 'That request was not valid.' });
      }
      const forward = resource === 'room-mute' ? { channelId: b.channelId, muted: b.muted } : { channelId: b.channelId };
      const upstream = await fetch(buildVaultCommunityChatRoomUrl(originResult.origin, resource), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(forward),
        signal: controller.signal,
        redirect: 'error',
      });
      const body = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        if (upstream.status === 503 && typeof body?.error === 'string') {
          return json(res, 503, { ok: false, code: 'not_set_up', message: body.error.slice(0, 160) });
        }
        return mapUpstreamError(res, upstream.status);
      }
      const topic = typeof body?.topic === 'string' && /^awc-chat-[a-f0-9]{16,64}$/.test(body.topic) ? body.topic : null;
      return json(res, 200, {
        ok: true,
        channelId: b.channelId,
        ...(resource === 'room-info'
          ? {
              topic,
              canStart: body?.canStart === true,
              name: typeof body?.name === 'string' ? body.name.slice(0, 120) : null,
              announceOnly: body?.announceOnly === true,
              visibility: typeof body?.visibility === 'string' ? body.visibility.slice(0, 20) : null,
              description: typeof body?.description === 'string' ? body.description.slice(0, 300) : null,
              // Older Vaults don't send canPost: everyone may post there.
              canPost: body?.canPost !== false,
              canPin: body?.canPin === true,
              canManage: body?.canManage === true,
              pinned: sanitizePinned(body?.pinned),
            }
          : {}),
        muted: body?.muted === true,
      });
    }

    if (resource === 'message-delete') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      const messageId =
        parsedBody.ok && parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body)
          ? String(parsedBody.body.messageId || '')
          : '';
      if (!UUID_RE.test(messageId) || Object.keys(parsedBody.body || {}).some((k) => k !== 'messageId')) {
        return json(res, 400, { ok: false, code: 'invalid_body', message: 'That request was not valid.' });
      }
      // Vault allows only the author (or church leaders) to remove a message.
      const upstream = await fetch(buildVaultCommunityChatDeleteMessageUrl(originResult.origin), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ messageId }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status, 'You can only remove your own messages.');
      return json(res, 200, { ok: true, messageId });
    }

    if (resource === 'message-report') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      const parsed = parsedBody.ok ? parseReportMessageCommand(parsedBody.body) : null;
      if (!parsed || !parsed.ok) {
        return json(res, 400, { ok: false, code: 'invalid_body', message: 'That report was not valid.' });
      }
      const command = { messageId: parsed.messageId, reason: parsed.reason, note: parsed.note };
      // Vault records the report against the signed-in member and alerts church leaders.
      const upstream = await fetch(buildVaultCommunityChatSubUrl(originResult.origin, 'report-message'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(command),
        signal: controller.signal,
        redirect: 'error',
      });
      if (upstream.status === 404 || upstream.status === 405 || upstream.status === 501) {
        return json(res, 503, {
          ok: false,
          code: 'report_unavailable',
          message: 'Reporting isn’t switched on yet. Please tell a church leader directly.',
        });
      }
      if (!upstream.ok) return mapUpstreamError(res, upstream.status, 'You can’t report messages in this chat.');
      return json(res, 200, { ok: true, messageId: command.messageId });
    }

    if (resource === 'attachment-upload-url' || resource === 'attachment-confirm') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, { ok: false, code: parsedBody.code, message: 'Please try again.' });
      }
      const isUrl = resource === 'attachment-upload-url';
      const command = isUrl
        ? parseAttachmentUploadCommand(parsedBody.body)
        : parseAttachmentConfirmCommand(parsedBody.body);
      if (!command.ok) {
        return json(res, command.reason === 'too_large' ? 413 : 400, {
          ok: false,
          code: command.reason === 'too_large' ? 'too_large' : 'invalid_body',
          message: command.reason === 'too_large' ? 'That file is too big (25 MB max).' : 'That upload was not valid.',
        });
      }
      const { ok: _ok, ...forward } = command;
      const upstream = await fetch(buildVaultCommunityChatAttachmentUrl(originResult.origin, isUrl ? 'url' : 'confirm'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(forward),
        signal: controller.signal,
        redirect: 'error',
      });
      const body = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        if (upstream.status === 401) return mapUpstreamError(res, 401);
        const vaultMessage = typeof body?.error === 'string' ? body.error.slice(0, 160) : '';
        return json(res, upstream.status === 413 ? 413 : upstream.status === 403 ? 403 : 400, {
          ok: false,
          code: 'upload_failed',
          message: vaultMessage || 'Could not send that file. Please try again.',
        });
      }
      if (isUrl) {
        const parsed = parseVaultUploadUrlResponse(body);
        if (!parsed.ok) {
          return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not start the upload.' });
        }
        return json(res, 200, { ok: true, ...parsed.upload });
      }
      const attachment = sanitizeChatAttachment(body?.attachment);
      if (!attachment) {
        return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Could not finish the upload.' });
      }
      return json(res, 200, { ok: true, attachment });
    }

    if (resource === 'huddle-can-start') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, { ok: false, code: parsedBody.code, message: 'Please try again.' });
      }
      const command = parseHuddleTokenCommand(parsedBody.body);
      if (!command.ok) {
        return json(res, 400, { ok: false, code: 'invalid_body', message: 'That huddle request was not valid.' });
      }
      const upstream = await fetch(buildVaultCommunityChatVoiceCanStartUrl(originResult.origin), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ channelId: command.channelId }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) return mapUpstreamError(res, upstream.status);
      const body = await upstream.json().catch(() => null);
      // Only a boolean leaves this bridge.
      return json(res, 200, { ok: true, channelId: command.channelId, canStart: body?.canStart === true });
    }

    if (resource === 'huddle-token') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, {
          ok: false,
          code: 'method_not_allowed',
          message: 'Huddle token only supports POST.',
        });
      }
      if (!allowHuddleTokenMint(auth.token)) {
        return json(res, 429, {
          ok: false,
          code: 'rate_limited',
          message: 'Too many huddle join attempts. Please wait a moment and try again.',
        });
      }
      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, {
          ok: false,
          code: parsedBody.code,
          message: 'Please try again.',
        });
      }
      const command = parseHuddleTokenCommand(parsedBody.body);
      if (!command.ok) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_body',
          message: 'That huddle request was not valid. Please try again.',
        });
      }
      const upstream = await fetch(buildVaultCommunityChatVoiceTokenUrl(originResult.origin), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ channelId: command.channelId }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        if (upstream.status === 403) {
          const errBody = await upstream.json().catch(() => null);
          if (isHuddleStartForbidden(403, errBody)) return huddleNotStarted(res);
        }
        return mapUpstreamError(
          res,
          upstream.status,
          'You do not have access to this Live Huddle.'
        );
      }
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Live Huddle is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultHuddleTokenResponse(body);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Live Huddle is temporarily unavailable. Please try again.',
        });
      }
      // Never echo hostId / coHostIds / channelCanModerate / secrets.
      return json(res, 200, { ok: true, ...parsed.token });
    }

    if (resource === 'huddle-line' || resource === 'huddle-daily-token') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'Only POST is supported.' });
      }
      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, { ok: false, code: parsedBody.code, message: 'Please try again.' });
      }
      if (resource === 'huddle-line') {
        const command = parseHuddleLineCommand(parsedBody.body);
        if (!command.ok) {
          return json(res, 400, { ok: false, code: 'invalid_body', message: 'That huddle request was not valid.' });
        }
        const upstream = await fetch(buildVaultHuddleFailsafeUrl(originResult.origin, 'line'), {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify(
            command.provider ? { channelId: command.channelId, provider: command.provider } : { channelId: command.channelId }
          ),
          signal: controller.signal,
          redirect: 'error',
        });
        let body = null;
        try {
          body = await upstream.json();
        } catch {
          body = null;
        }
        const line = parseVaultHuddleLineResponse(upstream.status, body);
        if (upstream.status === 401) {
          return mapUpstreamError(res, 401);
        }
        if (isHuddleStartForbidden(upstream.status, body)) return huddleNotStarted(res);
        // Reads that fail just mean "unknown line" — the client defaults to LiveKit.
        const status = line.ok ? 200 : upstream.status === 409 ? 409 : upstream.status >= 500 ? 503 : 400;
        return json(res, status, {
          ok: line.ok,
          provider: line.provider,
          occupied: line.occupied,
          ...(line.ok ? {} : { code: line.occupied ? 'huddle_line_busy' : 'huddle_line_unavailable', message: line.error || 'Could not check the huddle line.' }),
        });
      }
      if (!allowHuddleTokenMint(auth.token)) {
        return json(res, 429, { ok: false, code: 'rate_limited', message: 'Too many huddle join attempts. Please wait a moment and try again.' });
      }
      const command = parseHuddleTokenCommand(parsedBody.body);
      if (!command.ok) {
        return json(res, 400, { ok: false, code: 'invalid_body', message: 'That huddle request was not valid.' });
      }
      const upstream = await fetch(buildVaultHuddleFailsafeUrl(originResult.origin, 'daily'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ channelId: command.channelId }),
        signal: controller.signal,
        redirect: 'error',
      });
      let body = null;
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
      if (isHuddleStartForbidden(upstream.status, body)) return huddleNotStarted(res);
      if (!upstream.ok) {
        if (upstream.status === 401) return mapUpstreamError(res, 401);
        const vaultMessage = typeof body?.error === 'string' ? body.error.slice(0, 200) : '';
        return json(res, upstream.status === 409 ? 409 : upstream.status === 503 ? 503 : 502, {
          ok: false,
          code: upstream.status === 503 ? 'backup_line_unconfigured' : 'backup_line_unavailable',
          message: vaultMessage || 'Backup huddle audio is unavailable right now.',
        });
      }
      const parsed = parseVaultDailyTokenResponse(body);
      if (!parsed.ok) {
        return json(res, 502, { ok: false, code: 'invalid_upstream', message: 'Backup huddle audio is unavailable right now.' });
      }
      return json(res, 200, { ok: true, ...parsed.daily });
    }

    if (resource === 'huddle-end') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, {
          ok: false,
          code: 'method_not_allowed',
          message: 'Huddle end only supports POST.',
        });
      }
      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, {
          ok: false,
          code: parsedBody.code,
          message: 'Please try again.',
        });
      }
      const command = parseHuddleEndCommand(parsedBody.body);
      if (!command.ok) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_body',
          message: 'That huddle request was not valid. Please try again.',
        });
      }
      const upstream = await fetch(buildVaultCommunityChatVoiceEndUrl(originResult.origin), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ channelId: command.channelId }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        return mapUpstreamError(
          res,
          upstream.status,
          'Only moderators can end the Live Huddle for everyone.'
        );
      }
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Live Huddle is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultHuddleEndResponse(body);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Live Huddle is temporarily unavailable. Please try again.',
        });
      }
      return json(res, 200, {
        ok: true,
        ended: parsed.ended,
        channelId: command.channelId,
      });
    }

    if (resource === 'directory') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, {
          ok: false,
          code: 'method_not_allowed',
          message: 'Directory only supports GET.',
        });
      }
      const page = parseDirectoryQuery(query);
      if (!page.ok) {
        const message =
          page.reason === 'query_too_long'
            ? 'That search is too long. Please try a shorter name.'
            : page.reason === 'query_too_short' || page.reason === 'missing_q'
              ? 'Type a name to find someone to message.'
              : 'That search was not valid. Please try again.';
        return json(res, 400, {
          ok: false,
          code: 'invalid_query',
          message,
        });
      }
      const upstream = await fetch(buildVaultCommunityChatMentorsUrl(originResult.origin), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        return mapUpstreamError(
          res,
          upstream.status,
          'Member search is not available for this account yet.'
        );
      }
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultDirectoryResponse(body, page.q);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      return json(res, 200, { ok: true, members: parsed.members });
    }

    if (resource === 'dm') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, {
          ok: false,
          code: 'method_not_allowed',
          message: 'Direct messages only supports POST.',
        });
      }
      const parsedBody = parseJsonBody(req);
      if (!parsedBody.ok) {
        return json(res, parsedBody.status, {
          ok: false,
          code: parsedBody.code,
          message: 'Please try again.',
        });
      }
      const command = parseOpenDmCommand(parsedBody.body);
      if (!command.ok) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_body',
          message: 'That member could not be messaged. Please try again.',
        });
      }
      const upstream = await fetch(
        buildVaultCommunityChatDmChannelUrl(originResult.origin, command.partnerId),
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          signal: controller.signal,
          redirect: 'error',
        }
      );
      if (!upstream.ok) {
        return mapUpstreamError(
          res,
          upstream.status,
          'You cannot start a direct message with that member.'
        );
      }
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultDmChannelResponse(body, command.partnerId);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      return json(res, 200, {
        ok: true,
        channel: parsed.channel,
        partnerId: parsed.partnerId,
      });
    }

    // resource === 'unread'
    if (req.method === 'GET') {
      const { resource: _r, ...rest } = query;
      const q = parseChatUnreadQuery(rest);
      if (!q.ok) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_query',
          message: 'That chat request was not valid. Please try again.',
        });
      }
      const upstream = await fetch(buildVaultCommunityChatUnreadUrl(originResult.origin), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        return mapUpstreamError(res, upstream.status);
      }
      let body;
      try {
        body = await upstream.json();
      } catch {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      const parsed = parseVaultChatUnreadResponse(body);
      if (!parsed.ok) {
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'Chat is temporarily unavailable. Please try again.',
        });
      }
      return json(res, 200, {
        ok: true,
        count: parsed.count,
        byChannel: parsed.byChannel,
      });
    }

    const parsedBody = parseJsonBody(req);
    if (!parsedBody.ok) {
      return json(res, parsedBody.status, {
        ok: false,
        code: parsedBody.code,
        message: 'Please try again.',
      });
    }
    const command = parseMarkChatReadCommand(parsedBody.body);
    if (!command.ok) {
      return json(res, 400, {
        ok: false,
        code: 'invalid_body',
        message: 'That chat request was not valid. Please try again.',
      });
    }
    const upstream = await fetch(buildVaultCommunityChatMarkReadUrl(originResult.origin), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ channelId: command.channelId }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!upstream.ok) {
      return mapUpstreamError(res, upstream.status);
    }
    return json(res, 200, { ok: true, channelId: command.channelId });
  } catch (err) {
    const aborted = err && typeof err === 'object' && err.name === 'AbortError';
    console.error('[community-chat]', aborted ? 'timeout' : 'fetch_failed');
    return json(res, 502, {
      ok: false,
      code: 'vault_unavailable',
      message: 'Chat is temporarily unavailable. Please try again.',
    });
  } finally {
    clearTimeout(timer);
  }
}
