/**
 * Server-only Vault origin validation for the Connect member-self bridge.
 * Never accept an origin from the browser.
 */

/**
 * @param {unknown} raw
 * @param {{ allowHttpLocal?: boolean }} [opts]
 * @returns {{ ok: true, origin: string } | { ok: false, reason: string }}
 */
/** PLCC Chat always talks to the church's Vault; VAULT_API_ORIGIN only overrides it (e.g. local dev). */
export const DEFAULT_VAULT_API_ORIGIN = 'https://plcc-opal.vercel.app';

export function parseVaultApiOrigin(raw, opts = {}) {
  const allowHttpLocal = opts.allowHttpLocal === true;
  if (raw == null || (typeof raw === 'string' && !raw.trim())) raw = DEFAULT_VAULT_API_ORIGIN;
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'missing' };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'missing' };
  if (/\s/.test(trimmed)) return { ok: false, reason: 'invalid' };
  if (trimmed.includes('@')) return { ok: false, reason: 'credentials' };
  if (trimmed.includes('?') || trimmed.includes('#')) return { ok: false, reason: 'query_or_fragment' };

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (url.search || url.hash) return { ok: false, reason: 'query_or_fragment' };

  // Origin only — reject any non-root path
  if (url.pathname && url.pathname !== '/') {
    return { ok: false, reason: 'unexpected_path' };
  }

  const protocol = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  const isLocalHost =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';

  if (protocol === 'https:') {
    // ok
  } else if (protocol === 'http:' && allowHttpLocal && isLocalHost) {
    // local only
  } else {
    return { ok: false, reason: 'insecure' };
  }

  const origin = `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  return { ok: true, origin };
}

/** Fixed Vault self-user path — never taken from the client. */
export const VAULT_SELF_USER_PATH = '/api/vault?resource=users&self=true';

/** Fixed Vault users PATCH path — never taken from the client. */
export const VAULT_USERS_PATCH_PATH = '/api/vault?resource=users';

/** Fixed Vault phone auth path — never taken from the client. */
export const VAULT_AUTH_PHONE_PATH = '/api/vault?resource=auth-phone';

/** Fixed Vault kids ministry plans path — never taken from the client. */
export const VAULT_KIDS_PLANS_PATH = '/api/vault?resource=kids-plans';

/** Fixed Vault Community feed list path — never taken from the client. */
export const VAULT_COMMUNITY_FEED_PATH =
  '/api/vault?resource=community&subResource=feed&feedType=posts';

/** Fixed Vault Community single-post path prefix — id appended by builder only. */
export const VAULT_COMMUNITY_POST_PATH =
  '/api/vault?resource=community&subResource=feed&feedType=posts';

/** Fixed Vault member notifications path — never taken from the client. */
export const VAULT_NOTIFICATIONS_PATH = '/api/vault?resource=notifications';

/** Fixed Vault Community reaction path — never taken from the client. */
export const VAULT_COMMUNITY_REACTION_PATH =
  '/api/vault?resource=community&subResource=feed&feedType=reactions';

/** Fixed Vault Community comments path — never taken from the client. */
export const VAULT_COMMUNITY_COMMENTS_PATH =
  '/api/vault?resource=community&subResource=feed&feedType=comments';

/** Fixed Vault Community post-create path — same posts feedType; POST only from Connect. */
export const VAULT_COMMUNITY_POSTS_CREATE_PATH =
  '/api/vault?resource=community&subResource=feed&feedType=posts';

/** Fixed Vault Community mention-candidates path — never taken from the client. */
export const VAULT_COMMUNITY_MENTIONS_PATH =
  '/api/vault?resource=community&subResource=feed&feedType=mention-candidates';

/** Fixed Vault Community chat base — chatType appended by builders only. */
export const VAULT_COMMUNITY_CHAT_BASE =
  '/api/vault?resource=community&subResource=chat';

export const VAULT_COMMUNITY_CHAT_CHANNELS_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=channels`;
export const VAULT_COMMUNITY_CHAT_MESSAGES_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=messages`;
export const VAULT_COMMUNITY_CHAT_UNREAD_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=unread-count`;
export const VAULT_COMMUNITY_CHAT_MARK_READ_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=mark-read`;
export const VAULT_COMMUNITY_CHAT_HUDDLE_STATUSES_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=voice-huddle-statuses`;
export const VAULT_COMMUNITY_CHAT_VOICE_TOKEN_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=voice-token`;
export const VAULT_COMMUNITY_CHAT_MENTORS_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=mentors`;
export const VAULT_COMMUNITY_CHAT_DM_CHANNEL_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=dm-channel`;
export const VAULT_COMMUNITY_CHAT_VOICE_END_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=voice-huddle-end`;
export const VAULT_COMMUNITY_CHAT_VOICE_CAN_START_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=voice-huddle-can-start`;
/** Huddle fail-safes (Vault Oct 2026): database-down pass, shared line, backup line. */
export const VAULT_COMMUNITY_CHAT_VOICE_FALLBACK_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=voice-token-fallback`;
export const VAULT_COMMUNITY_CHAT_HUDDLE_LINE_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=voice-huddle-provider`;
export const VAULT_COMMUNITY_CHAT_DAILY_TOKEN_PATH = `${VAULT_COMMUNITY_CHAT_BASE}&subResource=voice-daily-token`;

/** @param {string} origin @param {'fallback'|'line'|'daily'} kind */
export function buildVaultHuddleFailsafeUrl(origin, kind) {
  const base = String(origin || '').replace(/\/+$/, '');
  const path =
    kind === 'fallback'
      ? VAULT_COMMUNITY_CHAT_VOICE_FALLBACK_PATH
      : kind === 'line'
        ? VAULT_COMMUNITY_CHAT_HUDDLE_LINE_PATH
        : kind === 'daily'
          ? VAULT_COMMUNITY_CHAT_DAILY_TOKEN_PATH
          : null;
  if (!path) throw new Error('unsupported huddle route');
  return `${base}${path}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultSelfUserUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_SELF_USER_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultUsersPatchUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_USERS_PATCH_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultAuthPhoneUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_AUTH_PHONE_PATH}`;
}

/** Fixed Vault text-code auth path (Twilio Verify) — never taken from the client. */
export const VAULT_AUTH_PHONE_CODE_PATH = '/api/vault?resource=auth-phone-code';

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultAuthPhoneCodeUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_AUTH_PHONE_CODE_PATH}`;
}

/**
 * @param {string} origin
 * @param {{ year?: string, classroom?: string }} [filters]
 * @returns {string}
 */
export function buildVaultKidsPlansUrl(origin, filters = {}) {
  const base = String(origin || '').replace(/\/+$/, '');
  const params = new URLSearchParams();
  // path already includes ?resource=kids-plans
  let url = `${base}${VAULT_KIDS_PLANS_PATH}`;
  const year = String(filters.year || '').trim();
  const classroom = String(filters.classroom || '').trim();
  if (/^\d{4}$/.test(year)) params.set('year', year);
  if (classroom) params.set('classroom', classroom.slice(0, 80));
  const qs = params.toString();
  if (qs) url += `&${qs}`;
  return url;
}

/**
 * @param {string} origin
 * @param {{ limit: number, offset: number }} page
 * @returns {string}
 */
export function buildVaultCommunityFeedUrl(origin, page) {
  const base = String(origin || '').replace(/\/+$/, '');
  const limit = Math.min(50, Math.max(1, Math.floor(Number(page.limit) || 20)));
  const offset = Math.max(0, Math.floor(Number(page.offset) || 0));
  return `${base}${VAULT_COMMUNITY_FEED_PATH}&limit=${limit}&offset=${offset}`;
}

/**
 * @param {string} origin
 * @param {string} postId — already validated UUID
 * @returns {string}
 */
export function buildVaultCommunityPostUrl(origin, postId) {
  const base = String(origin || '').replace(/\/+$/, '');
  const id = encodeURIComponent(String(postId || '').trim());
  return `${base}${VAULT_COMMUNITY_POST_PATH}&id=${id}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultNotificationsUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_NOTIFICATIONS_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultCommunityReactionUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_REACTION_PATH}`;
}

/**
 * @param {string} origin
 * @param {string} [postId] — for GET list
 * @returns {string}
 */
export function buildVaultCommunityCommentsUrl(origin, postId) {
  const base = String(origin || '').replace(/\/+$/, '');
  if (postId) {
    return `${base}${VAULT_COMMUNITY_COMMENTS_PATH}&postId=${encodeURIComponent(postId)}`;
  }
  return `${base}${VAULT_COMMUNITY_COMMENTS_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultCommunityPostsCreateUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_POSTS_CREATE_PATH}`;
}

/**
 * @param {string} origin
 * @param {string} q — already validated/trimmed query
 * @returns {string}
 */
export function buildVaultCommunityMentionsUrl(origin, q) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_MENTIONS_PATH}&q=${encodeURIComponent(String(q || ''))}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultCommunityChatChannelsUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_CHANNELS_PATH}`;
}

/**
 * @param {string} origin
 * @param {string} [channelId] — already validated UUID for GET list
 * @returns {string}
 */
export function buildVaultCommunityChatMessagesUrl(origin, channelId) {
  const base = String(origin || '').replace(/\/+$/, '');
  if (channelId) {
    return `${base}${VAULT_COMMUNITY_CHAT_MESSAGES_PATH}&channelId=${encodeURIComponent(channelId)}`;
  }
  return `${base}${VAULT_COMMUNITY_CHAT_MESSAGES_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultCommunityChatUnreadUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_UNREAD_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultCommunityChatMarkReadUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_MARK_READ_PATH}`;
}

/**
 * Batch LIVE huddle presence — channelIds already validated/joined.
 * @param {string} origin
 * @param {string} channelIdsCsv — comma-separated UUIDs
 * @returns {string}
 */
export function buildVaultCommunityChatHuddleStatusesUrl(origin, channelIdsCsv) {
  const base = String(origin || '').replace(/\/+$/, '');
  const ids = encodeURIComponent(String(channelIdsCsv || '').trim());
  return `${base}${VAULT_COMMUNITY_CHAT_HUDDLE_STATUSES_PATH}&channelIds=${ids}`;
}

/**
 * Mint LiveKit join token (POST). Secrets stay on Vault.
 * @param {string} origin
 * @returns {string}
 */
/**
 * Can this member START the room's huddle? (UI hint; Vault voice-token enforces.)
 * @param {string} origin
 * @returns {string}
 */
/** Any Vault chat sub-resource from a fixed allowlist (never caller-chosen strings). */
const CHAT_SUBS = new Set([
  'reactions',
  'polls',
  'poll-create',
  'poll-vote',
  'poll-close',
  'cards',
  'card-options',
  'card-create',
  'card-going',
  'requests',
  'request-create',
  'request-update',
  'edit-message',
  'read-receipts',
  'mention-candidates',
  'pin',
  'room-settings',
  'search',
  'channels',
  'channel-members',
  'member-picker',
  'chat-ministries',
  'dm-list',
  'archives',
  'room-archive',
  'report-message',
]);
export function buildVaultCommunityChatSubUrl(origin, sub) {
  if (!CHAT_SUBS.has(sub)) throw new Error('unknown chat sub-resource');
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_BASE}&subResource=${sub}`;
}

/** room-info | room-mute */
export function buildVaultCommunityChatRoomUrl(origin, which) {
  const base = String(origin || '').replace(/\/+$/, '');
  const sub = which === 'room-mute' ? 'room-mute' : 'room-info';
  return `${base}${VAULT_COMMUNITY_CHAT_BASE}&subResource=${sub}`;
}

export function buildVaultCommunityChatDeleteMessageUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_BASE}&subResource=delete-message`;
}

export function buildVaultCommunityChatAttachmentUrl(origin, step) {
  const base = String(origin || '').replace(/\/+$/, '');
  const sub = step === 'confirm' ? 'attachment-confirm' : 'attachment-upload-url';
  return `${base}${VAULT_COMMUNITY_CHAT_BASE}&subResource=${sub}`;
}

export function buildVaultCommunityChatVoiceCanStartUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_VOICE_CAN_START_PATH}`;
}

export function buildVaultCommunityChatVoiceTokenUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_VOICE_TOKEN_PATH}`;
}

/**
 * Member directory for New chat (GET). Filtered on Connect after fetch.
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultCommunityChatMentorsUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_MENTORS_PATH}`;
}

/**
 * Get-or-create DM channel (GET with partnerId).
 * @param {string} origin
 * @param {string} partnerId — already validated UUID
 * @returns {string}
 */
export function buildVaultCommunityChatDmChannelUrl(origin, partnerId) {
  const base = String(origin || '').replace(/\/+$/, '');
  const id = encodeURIComponent(String(partnerId || '').trim());
  return `${base}${VAULT_COMMUNITY_CHAT_DM_CHANNEL_PATH}&partnerId=${id}`;
}

/**
 * End Live Huddle for everyone (POST). Moderator-gated on Vault.
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultCommunityChatVoiceEndUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_COMMUNITY_CHAT_VOICE_END_PATH}`;
}

/** Vault News list/create — writes stay role-gated on Vault. */
export const VAULT_NEWS_PATH = '/api/vault?resource=vault-news';

/** Public database health probe (no auth on Vault). */
export const VAULT_HEALTH_PATH = '/api/vault?resource=health';

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultNewsUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_NEWS_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultHealthUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_HEALTH_PATH}`;
}

/** Family Huddle — Vault resource=family (household resolved server-side). */
export const VAULT_FAMILY_HUDDLE_BASE = '/api/vault?resource=family&subResource=huddle';

/**
 * @param {string} origin
 * @param {string} huddleType — status | token | end | invite-create | invite-redeem | invite-lock
 */
export function buildVaultFamilyHuddleUrl(origin, huddleType) {
  const base = String(origin || '').replace(/\/+$/, '');
  const type = encodeURIComponent(String(huddleType || 'status').trim());
  return `${base}${VAULT_FAMILY_HUDDLE_BASE}&huddleType=${type}`;
}

/**
 * Kids View (Vault parent dependents). Connect sends only an opaque cardRef;
 * no add/remove child and no PLCC Bucks award routes.
 */
export const VAULT_KIDS_VIEW_PATH =
  '/api/vault?resource=family&subResource=dependents&action=kids-view';
export const VAULT_KIDS_THEME_PATH =
  '/api/vault?resource=family&subResource=dependents&action=kids-theme';

/**
 * @param {string} origin
 * @param {string} cardRef already validated AWCD.<64 hex>
 */
export function buildVaultKidsViewUrl(origin, cardRef) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_KIDS_VIEW_PATH}&cardRef=${encodeURIComponent(cardRef)}`;
}

/** @param {string} origin */
export function buildVaultKidsThemeUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_KIDS_THEME_PATH}`;
}

/**
 * Check-in points (Vault api/_utils/checkinPointsHandler.ts). Point rules, QR
 * signing and the ledger stay on Vault; Connect only forwards the member token.
 */
export const VAULT_POINTS_BASE = '/api/vault?resource=attendance&subResource=';

/** Only member-side points routes — never the leader `self-qr` route. */
export const VAULT_POINTS_SUBRESOURCES = Object.freeze([
  'my-points',
  'points-leaderboard',
  'self-check-in',
]);

/** Caller's own membership pass. Connect never forwards a memberId. */
export const VAULT_MEMBER_PASS_PATH = '/api/vault?resource=people&subResource=member-pass';

/** Church system settings — Connect keeps only `seasonal`. */
export const VAULT_SYSTEM_SETTINGS_PATH = '/api/vault?resource=settings&scope=system';

/**
 * @param {string} origin
 * @param {string} subResource — one of VAULT_POINTS_SUBRESOURCES
 * @returns {string}
 */
export function buildVaultPointsUrl(origin, subResource) {
  if (!VAULT_POINTS_SUBRESOURCES.includes(subResource)) {
    throw new Error('unsupported points route');
  }
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_POINTS_BASE}${subResource}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultMemberPassUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_MEMBER_PASS_PATH}`;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultSystemSettingsUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_SYSTEM_SETTINGS_PATH}`;
}

/** RhemaNotes study guides published for members (Vault "Sermon Notes"). */
export const VAULT_STUDY_GUIDES_PATH = '/api/vault?resource=rhemanotes&action=library';

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildVaultStudyGuidesUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_STUDY_GUIDES_PATH}`;
}

/**
 * @param {string} origin
 * @param {string} shareToken already validated (24 hex)
 * @returns {string}
 */
export function buildVaultStudyGuideUrl(origin, shareToken) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/api/vault?resource=rhemanotes&action=guide&token=${encodeURIComponent(shareToken)}`;
}

/** Fixed Vault Prayer Wall path — POST only from Connect (members with sign-in, visitors without). */
export const VAULT_PRAYER_PATH = '/api/vault?resource=community&subResource=prayer';

/** @param {string} origin */
export function buildVaultPrayerUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${VAULT_PRAYER_PATH}`;
}

/** Fixed Vault Intercessors prayer-list path — GET only from Connect. */
export const VAULT_INTERCESSORS_PATH = '/api/vault?resource=community&subResource=intercessors';

/**
 * @param {string} origin
 * @param {{ action?: 'access', from?: string, to?: string }} [q]
 */
export function buildVaultIntercessorsUrl(origin, q = {}) {
  const base = String(origin || '').replace(/\/+$/, '');
  let url = `${base}${VAULT_INTERCESSORS_PATH}`;
  if (q.action === 'access') return `${url}&action=access`;
  if (q.view === 'answered') return `${url}&view=answered`;
  if (q.from) url += `&from=${encodeURIComponent(q.from)}`;
  if (q.to) url += `&to=${encodeURIComponent(q.to)}`;
  return url;
}
