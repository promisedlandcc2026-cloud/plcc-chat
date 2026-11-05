/**
 * Sanitize Vault Community chat (channels / messages / unread / huddle / DM directory) for Connect.
 * Text chat, DMs, start/join huddle, moderator end — no attachments, huddle-mod, or AI identity.
 */

import { sanitizeAvatarUrl } from './memberIdentity.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Conservative Connect message length (Vault accepts longer; keep mobile-safe). */
export const CHAT_MESSAGE_MAX_CHARS = 4000;
export const MAX_CHAT_BODY_BYTES = 8192;
/** Cap history returned to Connect even if Vault returns more. */
export const CONNECT_CHAT_MESSAGE_LIMIT = 200;
/** Max channel IDs accepted on huddle-status batch poll. */
export const HUDDLE_STATUS_MAX_CHANNELS = 50;
/** Cap LiveKit JWT length passed to the client. */
export const HUDDLE_TOKEN_MAX_CHARS = 8192;
/** Directory search bounds (require a query — no empty browse). */
export const DIRECTORY_QUERY_MIN_CHARS = 1;
export const DIRECTORY_QUERY_MAX_CHARS = 40;
export const DIRECTORY_RESULT_LIMIT = 25;

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asNullableString(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length ? t : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asIsoTimestamp(value) {
  const raw = asNullableString(value);
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/**
 * @param {unknown} content
 * @returns {{ ok: true, content: string } | { ok: false, reason: string }}
 */
export function validateConnectChatContent(content) {
  if (typeof content !== 'string') return { ok: false, reason: 'invalid_content' };
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length > CHAT_MESSAGE_MAX_CHARS) return { ok: false, reason: 'too_long' };
  return { ok: true, content: trimmed };
}

/**
 * GET query: exactly channelId UUID.
 * @param {Record<string, unknown> | null | undefined} query
 */
export function parseChatMessagesListQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  const keys = Object.keys(q);
  if (keys.length === 0) return { ok: false, reason: 'missing_channel_id' };
  if (keys.some((k) => k !== 'channelId')) return { ok: false, reason: 'unexpected_param' };
  if (keys.length !== 1) return { ok: false, reason: 'unexpected_param' };
  const raw = q.channelId;
  if (Array.isArray(raw)) return { ok: false, reason: 'duplicate_channel_id' };
  const channelId = asNullableString(raw);
  if (!channelId || !UUID_RE.test(channelId)) return { ok: false, reason: 'invalid_channel_id' };
  return { ok: true, channelId };
}

/**
 * Unread GET: empty query only (no client since — Vault uses server read status).
 * @param {Record<string, unknown> | null | undefined} query
 */
export function parseChatUnreadQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  if (Object.keys(q).length > 0) return { ok: false, reason: 'unexpected_param' };
  return { ok: true };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, channelId: string, content: string } | { ok: false, reason: string }}
 */
export function parseSendChatMessageCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid_body' };
  }
  /** @type {Record<string, unknown>} */
  const body = raw;
  const keys = Object.keys(body);
  const allowed = new Set(['channelId', 'content', 'parentId', 'mentionedUserIds']);
  if (keys.some((k) => !allowed.has(k))) return { ok: false, reason: 'unexpected_field' };

  const channelId = asNullableString(body.channelId);
  if (!channelId || !UUID_RE.test(channelId)) return { ok: false, reason: 'invalid_channel_id' };

  const contentResult = validateConnectChatContent(body.content);
  if (!contentResult.ok) return { ok: false, reason: contentResult.reason };

  // Reply (quote) — Vault checks the parent is in this room and not removed.
  let parentId = null;
  if (body.parentId != null) {
    parentId = asNullableString(body.parentId);
    if (!parentId || !UUID_RE.test(parentId)) return { ok: false, reason: 'invalid_parent_id' };
  }
  // @mentions — ids only; Vault checks they're real people and notifies them.
  let mentionedUserIds = [];
  if (body.mentionedUserIds != null) {
    if (!Array.isArray(body.mentionedUserIds) || body.mentionedUserIds.length > 20) {
      return { ok: false, reason: 'invalid_mentions' };
    }
    mentionedUserIds = [...new Set(body.mentionedUserIds.map((x) => String(x || '')))];
    if (mentionedUserIds.some((id) => !UUID_RE.test(id))) return { ok: false, reason: 'invalid_mentions' };
  }

  return { ok: true, channelId, content: contentResult.content, parentId, mentionedUserIds };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, channelId: string } | { ok: false, reason: string }}
 */
export function parseMarkChatReadCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid_body' };
  }
  /** @type {Record<string, unknown>} */
  const body = raw;
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'channelId')) return { ok: false, reason: 'unexpected_field' };
  const channelId = asNullableString(body.channelId);
  if (!channelId || !UUID_RE.test(channelId)) return { ok: false, reason: 'invalid_channel_id' };
  return { ok: true, channelId };
}

/**
 * @param {unknown} channel
 */
export function sanitizeChatChannel(channel) {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return null;
  /** @type {Record<string, unknown>} */
  const c = channel;
  const id = asNullableString(c.id);
  if (!id || !UUID_RE.test(id)) return null;

  const visibilityRaw = asNullableString(c.visibility)?.toLowerCase() || null;
  const type = asNullableString(c.type)?.toLowerCase() || null;
  const rawName = asNullableString(c.name) || 'Channel';
  const isDm =
    visibilityRaw === 'dm' ||
    rawName.startsWith('DM_') ||
    (type === 'private' && rawName.startsWith('DM_'));

  const ministryIdRaw =
    asNullableString(c.ministry_id) || asNullableString(c.ministryId);
  // A direct message never belongs to a ministry, so it can't show up on a
  // Ministry Hub's channel list.
  const ministryId =
    !isDm && ministryIdRaw && UUID_RE.test(ministryIdRaw) ? ministryIdRaw : null;

  return {
    id,
    name: isDm ? 'Direct message' : rawName,
    description: isDm ? null : asNullableString(c.description),
    visibility: isDm ? 'dm' : visibilityRaw || (type === 'public' ? 'open' : type),
    type: type || (isDm ? 'private' : 'public'),
    ministryId,
    announceOnly: !isDm && c.announce_only === true,
  };
}

// ---------------------------------------------------------------------------
// Set 4: groups, pins, search
// ---------------------------------------------------------------------------

const clip = (v, n) => (asNullableString(v) || '').slice(0, n);

/** Vault room-info pinned[] → [{ id, content, authorName, pinnedAt }]. */
export function sanitizePinned(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5)
    .map((p) => {
      const id = asNullableString(p?.id);
      if (!id || !UUID_RE.test(id)) return null;
      return {
        id,
        content: clip(p.content, 300),
        authorName: clip(p.authorName, 80) || 'Member',
        pinnedAt: asIsoTimestamp(p.pinnedAt),
      };
    })
    .filter(Boolean);
}

/** Vault search results → safe list (no storage paths, no emails). */
export function sanitizeSearchResults(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 50)
    .map((h) => {
      const id = asNullableString(h?.id);
      const channelId = asNullableString(h?.channelId);
      if (!id || !UUID_RE.test(id) || !channelId || !UUID_RE.test(channelId)) return null;
      const channelName = asNullableString(h.channelName);
      return {
        id,
        channelId,
        channelName: channelName && !channelName.startsWith('DM_') ? channelName.slice(0, 80) : null,
        content: clip(h.content, 400),
        authorName: clip(h.authorName, 80) || 'Member',
        createdAt: asIsoTimestamp(h.createdAt),
      };
    })
    .filter(Boolean);
}

/** Vault archives → [{ channelId, archivedAt }]. */
export function sanitizeArchives(raw) {
  const list = Array.isArray(raw?.archived) ? raw.archived : [];
  return list
    .slice(0, 500)
    .map((a) => {
      const channelId = asNullableString(a?.channelId);
      if (!channelId || !UUID_RE.test(channelId)) return null;
      return { channelId, archivedAt: asIsoTimestamp(a.archivedAt) };
    })
    .filter(Boolean);
}

/** Vault dm-list → your direct conversations (ids, the other person's name, last message). */
export function sanitizeDmList(raw) {
  const list = Array.isArray(raw?.conversations) ? raw.conversations : [];
  return list
    .slice(0, 100)
    .map((c) => {
      const channelId = asNullableString(c?.channelId);
      const partnerId = asNullableString(c?.partnerId);
      if (!channelId || !UUID_RE.test(channelId) || !partnerId || !UUID_RE.test(partnerId)) return null;
      return {
        channelId,
        partnerId,
        partnerName: clip(c.partnerName, 80) || 'Member',
        lastMessageAt: asIsoTimestamp(c.lastMessageAt),
        lastMessage: c.lastMessage == null ? null : clip(c.lastMessage, 120),
      };
    })
    .filter(Boolean);
}

/** People for the group pickers: id + name + role only (never email). */
export function sanitizePeople(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.members) ? raw.members : [];
  return list
    .slice(0, 300)
    .map((u) => {
      const id = asNullableString(u?.user_id) || asNullableString(u?.id);
      if (!id || !UUID_RE.test(id)) return null;
      return {
        id,
        name: clip(u.name, 80) || 'Member',
        roomRole: asNullableString(u.role) === 'moderator' ? 'admin' : 'member',
        isCreator: u.is_creator === true,
        fromMinistry: asNullableString(u.source) === 'ministry_sync',
      };
    })
    .filter(Boolean);
}

/**
 * POST group-create { name, description?, kind, ministryId?, memberIds?, announceOnly? }
 * @param {unknown} raw
 */
export function parseGroupCreateCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid_body' };
  const b = /** @type {Record<string, unknown>} */ (raw);
  const allowed = ['name', 'description', 'kind', 'ministryId', 'memberIds', 'announceOnly'];
  if (Object.keys(b).some((k) => !allowed.includes(k))) return { ok: false, reason: 'unexpected_field' };
  const name = (asNullableString(b.name) || '').trim().slice(0, 80);
  if (name.length < 2) return { ok: false, reason: 'name_required' };
  const kind = b.kind;
  if (kind !== 'open' && kind !== 'private' && kind !== 'ministry') return { ok: false, reason: 'invalid_kind' };
  let ministryId = null;
  if (kind === 'ministry') {
    ministryId = asNullableString(b.ministryId);
    if (!ministryId || !UUID_RE.test(ministryId)) return { ok: false, reason: 'ministry_required' };
  }
  const memberIds = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.map((x) => String(x || '')))] : [];
  if (memberIds.length > 300 || memberIds.some((id) => !UUID_RE.test(id))) return { ok: false, reason: 'invalid_members' };
  const description = (asNullableString(b.description) || '').trim().slice(0, 300) || null;
  return { ok: true, name, description, kind, ministryId, memberIds, announceOnly: b.announceOnly === true };
}

/**
 * @param {unknown} body
 */
export function parseVaultChatChannelsResponse(body) {
  if (!Array.isArray(body)) return { ok: false, reason: 'invalid_shape' };
  const channels = [];
  let skipped = 0;
  for (const row of body) {
    const sanitized = sanitizeChatChannel(row);
    if (sanitized) channels.push(sanitized);
    else skipped += 1;
  }
  return { ok: true, channels, skipped };
}

/**
 * @param {unknown} message
 */
/** Reactions members can use (same row for everyone; keeps the UI calm). */
export const CHAT_REACTIONS = ['👍', '❤️', '🙏', '😂', '😮', '😢', '🙌', '🔥'];

/**
 * Vault rows [{ user_id, emoji }] → [{ emoji, userIds }] in CHAT_REACTIONS order.
 * @param {unknown} raw
 */
export function summarizeReactions(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Map<string, Set<string>>} */
  const by = new Map();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const emoji = asNullableString(r.emoji);
    const userId = asNullableString(r.user_id) || asNullableString(r.userId);
    if (!emoji || !userId || !UUID_RE.test(userId) || !CHAT_REACTIONS.includes(emoji)) continue;
    if (!by.has(emoji)) by.set(emoji, new Set());
    by.get(emoji).add(userId);
  }
  return CHAT_REACTIONS.filter((e) => by.has(e)).map((emoji) => ({ emoji, userIds: [...by.get(emoji)].slice(0, 200) }));
}

/**
 * POST reaction { messageId, emoji, on }
 * @param {unknown} raw
 */
export function parseReactionCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid_body' };
  const b = /** @type {Record<string, unknown>} */ (raw);
  if (Object.keys(b).some((k) => !['messageId', 'emoji', 'on'].includes(k))) return { ok: false, reason: 'unexpected_field' };
  const messageId = asNullableString(b.messageId);
  if (!messageId || !UUID_RE.test(messageId)) return { ok: false, reason: 'invalid_message_id' };
  const emoji = asNullableString(b.emoji);
  if (!emoji || !CHAT_REACTIONS.includes(emoji)) return { ok: false, reason: 'invalid_emoji' };
  if (typeof b.on !== 'boolean') return { ok: false, reason: 'invalid_on' };
  return { ok: true, messageId, emoji, on: b.on };
}

/**
 * POST message-edit { messageId, content }
 * @param {unknown} raw
 */
export function parseEditMessageCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid_body' };
  const b = /** @type {Record<string, unknown>} */ (raw);
  if (Object.keys(b).some((k) => !['messageId', 'content'].includes(k))) return { ok: false, reason: 'unexpected_field' };
  const messageId = asNullableString(b.messageId);
  if (!messageId || !UUID_RE.test(messageId)) return { ok: false, reason: 'invalid_message_id' };
  const contentResult = validateConnectChatContent(b.content);
  if (!contentResult.ok) return { ok: false, reason: contentResult.reason };
  return { ok: true, messageId, content: contentResult.content };
}

/** Vault read-receipts → [{ userId, name, lastReadAt }]. */
export function parseVaultReadReceipts(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.readers)) return { ok: false };
  const readers = [];
  for (const r of body.readers.slice(0, 300)) {
    const userId = asNullableString(r?.userId);
    const lastReadAt = asIsoTimestamp(r?.lastReadAt);
    if (!userId || !UUID_RE.test(userId) || !lastReadAt) continue;
    readers.push({ userId, name: (asNullableString(r?.name) || 'Member').slice(0, 80), lastReadAt });
  }
  return { ok: true, readers };
}

/** Church role → short label for the @ list (leaders only; members get none). */
const ROLE_LABELS = {
  SUPER_ADMIN: 'Admin',
  ADMIN: 'Admin',
  ADMIN_STAFF: 'Staff',
  PASTOR: 'Pastor',
  FIRST_LADY: 'First Lady',
  SECRETARY: 'Secretary',
  ASST_SECRETARY: 'Secretary',
  MINISTRY_LEADER: 'Leader',
};
export function roleLabel(role) {
  return ROLE_LABELS[String(role || '').toUpperCase()] || null;
}

/** Vault mention-candidates → [{ id, name, label }]. */
export function parseVaultMentionCandidates(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.candidates) ? body.candidates : null;
  if (!list) return { ok: false };
  const people = [];
  for (const c of list.slice(0, 25)) {
    const id = asNullableString(c?.id) || asNullableString(c?.user_id);
    const name = asNullableString(c?.name) || asNullableString(c?.display_name);
    if (!id || !UUID_RE.test(id) || !name) continue;
    people.push({ id, name: name.slice(0, 80), label: roleLabel(c?.role) });
  }
  return { ok: true, people };
}

/** Chat media kinds the app can render. Vault stores image|file; audio/video come from the MIME type. */
export function chatMediaKind(mime) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * Only signed, private-bucket Supabase Storage links leave the bridge
 * (https://<project>.supabase.co/storage/v1/object/sign/community-files/...).
 * @param {unknown} value
 */
export function sanitizeChatMediaUrl(value) {
  const raw = asNullableString(value);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!/\.supabase\.(co|in)$/i.test(u.hostname)) return null;
    if (!u.pathname.startsWith('/storage/v1/object/sign/community-files/')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {{ id: string, kind: 'image'|'audio'|'video'|'file', name: string, mime: string, size: number, url: string | null } | null}
 */
export function sanitizeChatAttachment(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  /** @type {Record<string, unknown>} */
  const a = raw;
  const id = asNullableString(a.id);
  if (!id || !UUID_RE.test(id)) return null;
  const mime = (asNullableString(a.mime_type) || asNullableString(a.mimeType) || '').split(';')[0].trim().toLowerCase();
  const sizeRaw = Number(a.size_bytes ?? a.sizeBytes ?? 0);
  return {
    id,
    kind: chatMediaKind(mime),
    name: (asNullableString(a.original_filename) || asNullableString(a.name) || 'File').slice(0, 200),
    mime,
    size: Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.floor(sizeRaw) : 0,
    url: sanitizeChatMediaUrl(a.signed_url ?? a.url),
  };
}

export function sanitizeChatMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  /** @type {Record<string, unknown>} */
  const m = message;
  const id = asNullableString(m.id);
  if (!id || !UUID_RE.test(id)) return null;

  const channelId =
    asNullableString(m.channel_id) || asNullableString(m.channelId);
  if (!channelId || !UUID_RE.test(channelId)) return null;

  const isDeleted = Boolean(m.is_deleted || m.isDeleted || m.deleted_at);
  const createdAt = asIsoTimestamp(m.created_at) || asIsoTimestamp(m.createdAt);
  if (!createdAt) return null;

  const authorId = asNullableString(m.user_id) || asNullableString(m.userId);
  const authorName =
    asNullableString(m.display_name) ||
    asNullableString(m.displayName) ||
    asNullableString(m.user_name) ||
    asNullableString(m.userName) ||
    (authorId ? 'Member' : 'Vault AI');
  const avatarUrl = sanitizeAvatarUrl(
    asNullableString(m.avatar_url) || asNullableString(m.avatarUrl)
  );

  /** @type {{ id: string, name: string, avatarUrl: string | null } | null} */
  let author = null;
  if (authorId && UUID_RE.test(authorId)) {
    author = { id: authorId, name: authorName || 'Member', avatarUrl };
  } else if (!authorId) {
    // Server rows (no user) — only the Vault server writes these, so the known system names are trusted.
    if (asNullableString(m.user_name) === 'PLCC Prayer Requests') {
      author = { id: 'awc-prayer-requests', name: 'PLCC Prayer Requests', avatarUrl: null };
    } else {
      author = { id: 'vault-ai', name: 'Vault AI', avatarUrl: null };
    }
  } else {
    return null;
  }

  let parent = null;
  if (m.parent && typeof m.parent === 'object' && !Array.isArray(m.parent)) {
    /** @type {Record<string, unknown>} */
    const p = m.parent;
    const parentId = asNullableString(p.id);
    if (parentId && UUID_RE.test(parentId)) {
      parent = {
        id: parentId,
        name: asNullableString(p.user_name) || asNullableString(p.userName) || 'Member',
        content: p.is_deleted || p.isDeleted ? null : asNullableString(p.content),
        isDeleted: Boolean(p.is_deleted || p.isDeleted),
      };
    }
  }

  return {
    id,
    channelId,
    content: isDeleted ? '' : asNullableString(m.content) || '',
    isDeleted,
    createdAt,
    author,
    parent,
    editedAt: isDeleted ? null : asIsoTimestamp(m.edited_at) || asIsoTimestamp(m.editedAt),
    reactions: isDeleted ? [] : summarizeReactions(m.reactions),
    attachments:
      isDeleted || !Array.isArray(m.attachments)
        ? []
        : m.attachments.map(sanitizeChatAttachment).filter(Boolean).slice(0, 10),
  };
}

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST attachment-upload-url { messageId, filename, mimeType, sizeBytes }
 * @param {unknown} raw
 */
export function parseAttachmentUploadCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid_body' };
  /** @type {Record<string, unknown>} */
  const b = raw;
  const allowed = new Set(['messageId', 'filename', 'mimeType', 'sizeBytes']);
  if (Object.keys(b).some((k) => !allowed.has(k))) return { ok: false, reason: 'unexpected_field' };
  const messageId = asNullableString(b.messageId);
  if (!messageId || !UUID_RE.test(messageId)) return { ok: false, reason: 'invalid_message_id' };
  const mimeType = (asNullableString(b.mimeType) || '').split(';')[0].trim().toLowerCase();
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(mimeType)) return { ok: false, reason: 'invalid_mime' };
  const sizeBytes = Number(b.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, reason: 'invalid_size' };
  if (sizeBytes > UPLOAD_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const filename = (asNullableString(b.filename) || 'file').slice(0, 200);
  return { ok: true, messageId, filename, mimeType, sizeBytes: Math.floor(sizeBytes) };
}

/**
 * POST attachment-confirm { messageId, storagePath, filename, mimeType }
 * @param {unknown} raw
 */
export function parseAttachmentConfirmCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid_body' };
  /** @type {Record<string, unknown>} */
  const b = raw;
  const allowed = new Set(['messageId', 'storagePath', 'filename', 'mimeType']);
  if (Object.keys(b).some((k) => !allowed.has(k))) return { ok: false, reason: 'unexpected_field' };
  const messageId = asNullableString(b.messageId);
  if (!messageId || !UUID_RE.test(messageId)) return { ok: false, reason: 'invalid_message_id' };
  const storagePath = asNullableString(b.storagePath);
  if (!storagePath || storagePath.length > 300 || !storagePath.includes(`/${messageId}/`)) {
    return { ok: false, reason: 'invalid_path' };
  }
  const mimeType = (asNullableString(b.mimeType) || '').split(';')[0].trim().toLowerCase();
  const filename = (asNullableString(b.filename) || 'file').slice(0, 200);
  return { ok: true, messageId, storagePath, filename, mimeType };
}

/** Vault attachment-upload-url → only what the phone needs to upload. */
export function parseVaultUploadUrlResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.ok !== true) return { ok: false };
  const storagePath = asNullableString(body.storagePath);
  const uploadToken = asNullableString(body.uploadToken);
  const bucket = asNullableString(body.bucket);
  if (!storagePath || !uploadToken || bucket !== 'community-files') return { ok: false };
  return { ok: true, upload: { bucket, storagePath, uploadToken, mimeType: asNullableString(body.mimeType) || '' } };
}

/**
 * @param {unknown} body
 */
export function parseVaultChatMessagesResponse(body) {
  if (!Array.isArray(body)) return { ok: false, reason: 'invalid_shape' };
  const messages = [];
  let skipped = 0;
  for (const row of body) {
    const sanitized = sanitizeChatMessage(row);
    if (sanitized) messages.push(sanitized);
    else skipped += 1;
  }
  const capped =
    messages.length > CONNECT_CHAT_MESSAGE_LIMIT
      ? messages.slice(messages.length - CONNECT_CHAT_MESSAGE_LIMIT)
      : messages;
  return {
    ok: true,
    messages: capped,
    skipped,
    truncated: messages.length > CONNECT_CHAT_MESSAGE_LIMIT,
  };
}

/**
 * @param {unknown} body
 */
export function parseVaultChatMessageMutationResponse(body) {
  const sanitized = sanitizeChatMessage(body);
  if (!sanitized) return { ok: false, reason: 'malformed_message' };
  return { ok: true, message: sanitized };
}

/**
 * @param {unknown} body
 */
export function parseVaultChatUnreadResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  /** @type {Record<string, unknown>} */
  const b = body;
  const countRaw = b.count;
  const count =
    typeof countRaw === 'number' && Number.isFinite(countRaw)
      ? Math.max(0, Math.floor(countRaw))
      : 0;

  /** @type {Record<string, number>} */
  const byChannel = {};
  if (b.byChannel && typeof b.byChannel === 'object' && !Array.isArray(b.byChannel)) {
    for (const [key, value] of Object.entries(b.byChannel)) {
      if (!UUID_RE.test(key)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      byChannel[key] = Math.max(0, Math.floor(value));
    }
  }

  return { ok: true, count, byChannel };
}

/**
 * GET query: channelIds=uuid,uuid,… (1–HUDDLE_STATUS_MAX_CHANNELS).
 * @param {Record<string, unknown> | null | undefined} query
 */
export function parseHuddleStatusQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  const keys = Object.keys(q);
  if (keys.length === 0) return { ok: false, reason: 'missing_channel_ids' };
  if (keys.some((k) => k !== 'channelIds')) return { ok: false, reason: 'unexpected_param' };
  const raw = q.channelIds;
  if (Array.isArray(raw)) return { ok: false, reason: 'duplicate_channel_ids' };
  const csv = asNullableString(raw);
  if (!csv) return { ok: false, reason: 'missing_channel_ids' };

  const parts = csv.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: 'missing_channel_ids' };
  if (parts.length > HUDDLE_STATUS_MAX_CHANNELS) {
    return { ok: false, reason: 'too_many_channel_ids' };
  }

  /** @type {string[]} */
  const channelIds = [];
  const seen = new Set();
  for (const id of parts) {
    if (!UUID_RE.test(id)) return { ok: false, reason: 'invalid_channel_id' };
    if (seen.has(id)) continue;
    seen.add(id);
    channelIds.push(id);
  }
  if (channelIds.length === 0) return { ok: false, reason: 'missing_channel_ids' };
  return { ok: true, channelIds };
}

/**
 * POST body: { channelId } only — shared by huddle-token and huddle-end.
 * @param {unknown} raw
 */
export function parseHuddleTokenCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid_body' };
  }
  /** @type {Record<string, unknown>} */
  const body = raw;
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'channelId')) return { ok: false, reason: 'unexpected_field' };
  const channelId = asNullableString(body.channelId);
  if (!channelId || !UUID_RE.test(channelId)) return { ok: false, reason: 'invalid_channel_id' };
  return { ok: true, channelId };
}

/** Alias for huddle-end body (same shape as token). */
export const parseHuddleEndCommand = parseHuddleTokenCommand;

/**
 * Normalize directory search text: trim and strip leading @ (mention habit).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeDirectoryQuery(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .trim();
}

/**
 * GET query: resource=directory&q= (bounded; required).
 * @param {Record<string, unknown> | null | undefined} query
 */
export function parseDirectoryQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  const keys = Object.keys(q);
  if (keys.some((k) => k !== 'q' && k !== 'resource')) {
    return { ok: false, reason: 'unexpected_param' };
  }
  const raw = q.q;
  if (Array.isArray(raw)) return { ok: false, reason: 'duplicate_q' };
  if (raw == null || typeof raw !== 'string') return { ok: false, reason: 'missing_q' };
  const trimmed = normalizeDirectoryQuery(raw);
  if (!trimmed) return { ok: false, reason: 'missing_q' };
  if (trimmed.length < DIRECTORY_QUERY_MIN_CHARS) {
    return { ok: false, reason: 'query_too_short' };
  }
  if (trimmed.length > DIRECTORY_QUERY_MAX_CHARS) {
    return { ok: false, reason: 'query_too_long' };
  }
  return { ok: true, q: trimmed };
}

/**
 * POST body: { partnerId } only.
 * @param {unknown} raw
 */
export function parseOpenDmCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid_body' };
  }
  /** @type {Record<string, unknown>} */
  const body = raw;
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'partnerId')) return { ok: false, reason: 'unexpected_field' };
  const partnerId = asNullableString(body.partnerId);
  if (!partnerId || !UUID_RE.test(partnerId)) return { ok: false, reason: 'invalid_partner_id' };
  return { ok: true, partnerId };
}

export const REPORT_REASONS = Object.freeze(['inappropriate', 'harassment', 'safety', 'spam', 'other']);
export const MAX_REPORT_NOTE_CHARS = 500;

/**
 * Report a message to church leaders: { messageId, reason, note? }.
 * @param {unknown} raw
 * @returns {{ ok: true, messageId: string, reason: string, note: string } | { ok: false, reason: string }}
 */
export function parseReportMessageCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid_body' };
  }
  /** @type {Record<string, unknown>} */
  const body = raw;
  if (Object.keys(body).some((k) => k !== 'messageId' && k !== 'reason' && k !== 'note')) {
    return { ok: false, reason: 'unexpected_field' };
  }
  const messageId = asNullableString(body.messageId);
  if (!messageId || !UUID_RE.test(messageId)) return { ok: false, reason: 'invalid_message_id' };
  const reason = asNullableString(body.reason);
  if (!reason || !REPORT_REASONS.includes(reason)) return { ok: false, reason: 'invalid_reason' };
  if (body.note != null && typeof body.note !== 'string') return { ok: false, reason: 'invalid_note' };
  const note = String(body.note || '').trim();
  if (note.length > MAX_REPORT_NOTE_CHARS) return { ok: false, reason: 'note_too_long' };
  return { ok: true, messageId, reason, note };
}

/**
 * @param {unknown} row
 * @returns {{ id: string, name: string, avatarUrl: string | null } | null}
 */
export function sanitizeDirectoryMember(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  /** @type {Record<string, unknown>} */
  const u = row;
  const id = asNullableString(u.id);
  if (!id || !UUID_RE.test(id)) return null;
  const name = asNullableString(u.name);
  if (!name) return null;
  return {
    id,
    name,
    avatarUrl: sanitizeAvatarUrl(
      asNullableString(u.avatar_url) || asNullableString(u.avatarUrl)
    ),
  };
}

/**
 * Vault mentors array → filtered, sanitized directory (no email/role).
 * @param {unknown} body
 * @param {string} q
 */
export function parseVaultDirectoryResponse(body, q) {
  if (!Array.isArray(body)) return { ok: false, reason: 'invalid_shape' };
  const needle = normalizeDirectoryQuery(q).toLowerCase();
  if (!needle) return { ok: false, reason: 'missing_q' };

  /** @type {Array<{ id: string, name: string, avatarUrl: string | null }>} */
  const members = [];
  for (const row of body) {
    const sanitized = sanitizeDirectoryMember(row);
    if (!sanitized) continue;
    if (!sanitized.name.toLowerCase().includes(needle)) continue;
    members.push(sanitized);
    if (members.length >= DIRECTORY_RESULT_LIMIT) break;
  }
  return { ok: true, members };
}

/**
 * Vault dm-channel row → Connect channel + partnerId echo.
 * @param {unknown} body
 * @param {string} partnerId
 */
export function parseVaultDmChannelResponse(body, partnerId) {
  const channel = sanitizeChatChannel(body);
  if (!channel) return { ok: false, reason: 'malformed_channel' };
  return {
    ok: true,
    channel: {
      ...channel,
      visibility: 'dm',
      name: channel.visibility === 'dm' ? channel.name : 'Direct message',
    },
    partnerId,
  };
}

/**
 * Vault voice-huddle-end → { ok, ended }.
 * @param {unknown} body
 */
export function parseVaultHuddleEndResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  /** @type {Record<string, unknown>} */
  const b = body;
  if (b.ok === false) return { ok: false, reason: 'not_ok' };
  return {
    ok: true,
    ended: Boolean(b.ended),
    roomName: asNullableString(b.roomName) || asNullableString(b.room_name),
  };
}

/**
 * @param {unknown} entry
 * @returns {{ active: boolean, participantCount: number } | null}
 */
function sanitizeHuddleStatusEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  /** @type {Record<string, unknown>} */
  const e = entry;
  const active = Boolean(e.active || e.live);
  const countRaw = e.participantCount ?? e.participant_count;
  const participantCount =
    typeof countRaw === 'number' && Number.isFinite(countRaw)
      ? Math.max(0, Math.floor(countRaw))
      : 0;
  return { active, participantCount };
}

/**
 * Vault: { ok, configured?, byChannel: { [uuid]: { active, participantCount } } }
 * Connect: { byChannel: { [uuid]: { live, participantCount } } }
 * @param {unknown} body
 * @param {string[]} [requestedIds]
 */
export function parseVaultHuddleStatusesResponse(body, requestedIds) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  /** @type {Record<string, unknown>} */
  const b = body;
  if (b.ok === false) return { ok: false, reason: 'not_ok' };

  const allow =
    Array.isArray(requestedIds) && requestedIds.length > 0
      ? new Set(requestedIds)
      : null;

  /** @type {Record<string, { live: boolean, participantCount: number }>} */
  const byChannel = {};
  const src =
    b.byChannel && typeof b.byChannel === 'object' && !Array.isArray(b.byChannel)
      ? b.byChannel
      : {};

  for (const [key, value] of Object.entries(src)) {
    if (!UUID_RE.test(key)) continue;
    if (allow && !allow.has(key)) continue;
    const entry = sanitizeHuddleStatusEntry(value);
    if (!entry) continue;
    byChannel[key] = {
      live: entry.active,
      participantCount: entry.participantCount,
    };
  }

  // Ensure requested IDs appear (inactive) so the client can clear LIVE badges.
  if (allow) {
    for (const id of allow) {
      if (!(id in byChannel)) {
        byChannel[id] = { live: false, participantCount: 0 };
      }
    }
  }

  return { ok: true, byChannel };
}

/**
 * LiveKit URL must be https or wss — never leak arbitrary schemes.
 * @param {unknown} value
 * @returns {string | null}
 */
function sanitizeLiveKitUrl(value) {
  const raw = asNullableString(value);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'wss:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Vault voice-token → Connect join payload. Drops host/coHost/channelCanModerate/etc.
 * @param {unknown} body
 */
export function parseVaultHuddleTokenResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  /** @type {Record<string, unknown>} */
  const b = body;
  if (b.ok === false) return { ok: false, reason: 'not_ok' };

  const token = asNullableString(b.token);
  if (!token || token.length > HUDDLE_TOKEN_MAX_CHARS) {
    return { ok: false, reason: 'invalid_token' };
  }
  // Reject obvious secret leakage in the JWT payload field names we never expect.
  if (/LIVEKIT_API_SECRET|api[_-]?secret/i.test(token)) {
    return { ok: false, reason: 'invalid_token' };
  }

  const url = sanitizeLiveKitUrl(b.url);
  if (!url) return { ok: false, reason: 'invalid_url' };

  const roomName = asNullableString(b.roomName) || asNullableString(b.room_name);
  if (!roomName || roomName.length > 256) return { ok: false, reason: 'invalid_room' };

  const channelId =
    asNullableString(b.channelId) || asNullableString(b.channel_id);
  if (!channelId || !UUID_RE.test(channelId)) {
    return { ok: false, reason: 'invalid_channel_id' };
  }

  const channelName =
    asNullableString(b.channelName) ||
    asNullableString(b.channel_name) ||
    'Channel';

  const expiresRaw = b.expiresIn ?? b.expires_in;
  const expiresIn =
    typeof expiresRaw === 'number' && Number.isFinite(expiresRaw)
      ? Math.max(0, Math.floor(expiresRaw))
      : 0;

  return {
    ok: true,
    token: {
      token,
      url,
      roomName,
      expiresIn,
      canModerate: Boolean(b.canModerate),
      channelId,
      channelName,
      // Vault-signed 12h permission to reopen this huddle while Supabase is down.
      // Opaque to Connect: stored on the member's phone, sent back only to Vault.
      ...(sanitizeHuddleFallbackPass(b.fallbackPass) ? { fallbackPass: sanitizeHuddleFallbackPass(b.fallbackPass) } : {}),
      ...(b.fallback === true ? { fallback: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Huddle fail-safes (mirrors PLCC Canaan huddleFallbackPass.ts + huddleProvider.ts)
// ---------------------------------------------------------------------------

export const HUDDLE_FALLBACK_PASS_MAX_CHARS = 2048;
const FALLBACK_PASS_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** @param {unknown} value */
export function sanitizeHuddleFallbackPass(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > HUDDLE_FALLBACK_PASS_MAX_CHARS) return null;
  return FALLBACK_PASS_RE.test(raw) ? raw : null;
}

/** POST body for huddle-token-fallback: { channelId, fallbackPass } only. */
export function parseHuddleFallbackCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const keys = Object.keys(body).sort();
  if (keys.join(',') !== 'channelId,fallbackPass') return { ok: false };
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  if (!UUID_RE.test(channelId)) return { ok: false };
  const fallbackPass = sanitizeHuddleFallbackPass(body.fallbackPass);
  if (!fallbackPass) return { ok: false };
  return { ok: true, channelId, fallbackPass };
}

/** POST body for huddle-line: { channelId, provider? } where provider is livekit|daily. */
export function parseHuddleLineCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  for (const k of Object.keys(body)) if (k !== 'channelId' && k !== 'provider') return { ok: false };
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  if (!UUID_RE.test(channelId)) return { ok: false };
  if (body.provider === undefined) return { ok: true, channelId, provider: null };
  if (body.provider !== 'livekit' && body.provider !== 'daily') return { ok: false };
  return { ok: true, channelId, provider: body.provider };
}

/** @param {unknown} value */
function lineName(value) {
  return value === 'daily' || value === 'livekit' ? value : null;
}

/** Vault voice-huddle-provider → { provider, occupied, error } (no other fields). */
export function parseVaultHuddleLineResponse(status, body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const error = typeof b.error === 'string' ? b.error.slice(0, 200) : null;
  return {
    ok: status >= 200 && status < 300 && b.ok !== false,
    provider: lineName(b.provider),
    occupied: b.occupied === true,
    ...(error ? { error } : {}),
  };
}

/** Daily room URLs only (https://<team>.daily.co/<room>). */
export function sanitizeDailyUrl(value) {
  const raw = asNullableString(value);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!/(^|\.)daily\.co$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Vault voice-daily-token → backup-line join payload. */
export function parseVaultDailyTokenResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  if (body.ok === false) return { ok: false };
  const token = asNullableString(body.token);
  if (!token || token.length > HUDDLE_TOKEN_MAX_CHARS) return { ok: false };
  const url = sanitizeDailyUrl(body.url);
  if (!url) return { ok: false };
  const channelId = asNullableString(body.channelId);
  if (!channelId || !UUID_RE.test(channelId)) return { ok: false };
  const expiresRaw = body.expiresIn;
  return {
    ok: true,
    daily: {
      provider: 'daily',
      token,
      url,
      roomName: (asNullableString(body.roomName) || '').slice(0, 256),
      expiresIn: typeof expiresRaw === 'number' && Number.isFinite(expiresRaw) ? Math.max(0, Math.floor(expiresRaw)) : 0,
      channelId,
    },
  };
}

export { UUID_RE };

const POLL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_OPTION_RE = /^o\d{1,2}$/;

/** A chat poll as members see it (whitelisted fields only). */
export function sanitizePoll(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  const messageId = String(raw.messageId || '');
  if (!POLL_ID_RE.test(id) || !POLL_ID_RE.test(messageId)) return null;
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .slice(0, 10)
    .filter((o) => o && POLL_OPTION_RE.test(String(o.id || '')))
    .map((o) => ({
      id: String(o.id),
      text: String(o.text || '').slice(0, 100),
      count: Math.max(0, Math.floor(Number(o.count) || 0)),
      voters: (Array.isArray(o.voters) ? o.voters : []).slice(0, 50).map((n) => String(n || 'Member').slice(0, 80)),
    }));
  if (options.length < 2) return null;
  const valid = new Set(options.map((o) => o.id));
  return {
    id,
    messageId,
    question: String(raw.question || '').slice(0, 300),
    multi: raw.multi === true,
    anonymous: raw.anonymous === true,
    closed: raw.closed === true,
    isMine: raw.isMine === true,
    totalVoters: Math.max(0, Math.floor(Number(raw.totalVoters) || 0)),
    myVotes: (Array.isArray(raw.myVotes) ? raw.myVotes : []).map(String).filter((v) => valid.has(v)),
    options,
  };
}

const CARD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, max) => (v == null || v === '' ? null : String(v).slice(0, max));
const httpsUrl = (v) => (/^https:\/\/[^\s"'<>]+$/i.test(String(v || '')) ? String(v).slice(0, 500) : null);
const isoOrNull = (v) => (v && !Number.isNaN(new Date(String(v)).getTime()) ? String(v).slice(0, 40) : null);
const nat = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : null);

/** An event or Serve card on a chat message (whitelisted fields only). */
export function sanitizeChatCard(raw) {
  if (!raw || typeof raw !== 'object' || !CARD_ID_RE.test(String(raw.messageId || ''))) return null;
  const messageId = String(raw.messageId);
  if (raw.kind === 'event') {
    if (raw.missing || !raw.event) return { messageId, kind: 'event', missing: true };
    const e = raw.event;
    if (!CARD_ID_RE.test(String(e.id || ''))) return null;
    return {
      messageId,
      kind: 'event',
      event: {
        id: String(e.id),
        title: str(e.title, 200) || 'Event',
        startsAt: isoOrNull(e.startsAt),
        timeLabel: str(e.timeLabel, 40),
        endTime: str(e.endTime, 40),
        location: str(e.location, 200),
        imageUrl: httpsUrl(e.imageUrl),
        signupUrl: httpsUrl(e.signupUrl),
        going: e.going === true,
        goingCount: nat(e.goingCount) || 0,
      },
    };
  }
  if (raw.kind === 'serve') {
    if (raw.missing || !raw.serve) return { messageId, kind: 'serve', missing: true };
    const o = raw.serve;
    if (!CARD_ID_RE.test(String(o.id || ''))) return null;
    return {
      messageId,
      kind: 'serve',
      serve: {
        id: String(o.id),
        title: str(o.title, 200) || 'Serve',
        roleLabel: str(o.roleLabel, 120),
        description: str(o.description, 500),
        startsAt: isoOrNull(o.startsAt),
        endsAt: isoOrNull(o.endsAt),
        location: str(o.location, 200),
        capacity: nat(o.capacity),
        spotsLeft: nat(o.spotsLeft),
        open: o.open !== false,
        requiresApproval: o.requiresApproval === true,
        mySignup: o.mySignup === 'pending' || o.mySignup === 'confirmed' ? o.mySignup : null,
      },
    };
  }
  return null;
}

/** Picker lists for "Share an event / Serve need". */
export function sanitizeCardOptions(raw) {
  const ev = (Array.isArray(raw?.events) ? raw.events : [])
    .filter((e) => CARD_ID_RE.test(String(e?.id || '')))
    .slice(0, 25)
    .map((e) => ({ id: String(e.id), title: str(e.title, 200) || 'Event', startsAt: isoOrNull(e.startsAt), location: str(e.location, 200) }));
  const sv = (Array.isArray(raw?.serve) ? raw.serve : [])
    .filter((o) => CARD_ID_RE.test(String(o?.id || '')))
    .slice(0, 25)
    .map((o) => ({ id: String(o.id), title: str(o.title, 200) || 'Serve', roleLabel: str(o.roleLabel, 120), startsAt: isoOrNull(o.startsAt) }));
  return { events: ev, serve: sv };
}

const REQ_STATUSES = new Set(['new', 'assigned', 'done', 'cancelled']);
const REQ_CATEGORIES = new Set(['ride', 'visit', 'meal', 'errand', 'other']);
const person = (p) => (p && CARD_ID_RE.test(String(p.id || '')) ? { id: String(p.id), name: String(p.name || 'Member').slice(0, 80) } : null);

/** A help request on a chat message (whitelisted fields only). */
export function sanitizeChatRequest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!CARD_ID_RE.test(String(raw.id || '')) || !CARD_ID_RE.test(String(raw.messageId || ''))) return null;
  if (!REQ_STATUSES.has(raw.status) || !REQ_CATEGORIES.has(raw.category)) return null;
  const askedBy = person(raw.askedBy);
  if (!askedBy) return null;
  const can = raw.can && typeof raw.can === 'object' ? raw.can : {};
  return {
    id: String(raw.id),
    messageId: String(raw.messageId),
    channelId: CARD_ID_RE.test(String(raw.channelId || '')) ? String(raw.channelId) : null,
    category: raw.category,
    categoryLabel: String(raw.categoryLabel || 'Help').slice(0, 40),
    details: String(raw.details || '').slice(0, 1000),
    status: raw.status,
    askedBy,
    helper: person(raw.helper),
    createdAt: isoOrNull(raw.createdAt),
    updatedAt: isoOrNull(raw.updatedAt),
    doneAt: isoOrNull(raw.doneAt),
    isMine: raw.isMine === true,
    isHelper: raw.isHelper === true,
    can: {
      volunteer: can.volunteer === true,
      assign: can.assign === true,
      unassign: can.unassign === true,
      done: can.done === true,
      reopen: can.reopen === true,
      cancel: can.cancel === true,
      note: can.note === true,
    },
    history: (Array.isArray(raw.history) ? raw.history : []).slice(-20).map((h) => ({
      action: String(h?.action || '').slice(0, 20),
      by: String(h?.by || 'Member').slice(0, 80),
      note: h?.note ? String(h.note).slice(0, 500) : null,
      at: isoOrNull(h?.at),
      to: h?.to ? String(h.to).slice(0, 80) : null,
    })),
  };
}
