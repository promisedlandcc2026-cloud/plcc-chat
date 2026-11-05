/**
 * Sanitize Vault GET ?resource=users&self=true responses for Connect.
 * Fail closed on unknown roles. Never pass through password hashes or admin blobs.
 */

/** Vault roles that may use Connect as approved members (no admin tools exposed). */
export const APPROVED_MEMBER_ROLES = Object.freeze([
  'SUPER_ADMIN',
  'PASTOR',
  'MINISTRY_LEADER',
  'FINANCE',
  'MEDIA_TEAM',
  'ADMIN_STAFF',
  'STAFF',
  'SECRETARY',
  'ASST_SECRETARY',
  'FIRST_LADY',
  'WORSHIP_TEAM',
  'SUNDAY_SCHOOL_TEACHER',
  'VOLUNTEER',
  'GUEST',
  'MEMBER',
  'PARENT',
  'TEACHER',
  'YOUTH',
  'ADMIN', // legacy
  'USER', // legacy fallback — treated as approved app role, not PENDING
]);

/** Bump when Connect media notice copy changes materially so members re-acknowledge. */
export const MEDIA_NOTICE_VERSION = 'awc-media-notice-v1';

/** Allowed PATCH actions on /api/member-self — never accept arbitrary prefs blobs. */
export const MEMBER_SELF_PATCH_ACTIONS = Object.freeze([
  'complete_onboarding',
  'acknowledge_media_notice',
]);

export const MAX_MEMBER_SELF_PATCH_BODY_BYTES = 2048;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} role
 * @returns {'approved' | 'pending'}
 */
export function approvalStatusFromRole(role) {
  const normalized = String(role || '')
    .trim()
    .toUpperCase();
  if (!normalized || normalized === 'PENDING') return 'pending';
  if (APPROVED_MEMBER_ROLES.includes(normalized)) return 'approved';
  // Unknown roles fail closed
  return 'pending';
}

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
 * Allow only http(s) avatar URLs — reject javascript: and data: for safety in img src.
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeAvatarUrl(value) {
  const raw = asNullableString(value);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return raw;
  } catch {
    // Relative path from storage is uncommon for avatar_url (usually absolute public URL)
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return null;
  }
}

/**
 * @param {unknown} email
 * @returns {string | null}
 */
function sanitizeEmail(email) {
  const raw = asNullableString(email);
  if (!raw) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  // Hide Vault orphan synthetics from Connect UI
  if (raw.toLowerCase().endsWith('@awc-vault.local')) return null;
  return raw.toLowerCase();
}

/**
 * Extract safe media-notice acknowledgement from Vault notification_prefs.
 * @param {unknown} prefs
 * @returns {{ acknowledgedAt: string, version: string | null } | null}
 */
export function sanitizeMediaNotice(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return null;
  const media = /** @type {Record<string, unknown>} */ (prefs).mediaNotice;
  if (!media || typeof media !== 'object' || Array.isArray(media)) return null;
  const acknowledgedAt = asNullableString(
    /** @type {Record<string, unknown>} */ (media).acknowledgedAt
  );
  if (!acknowledgedAt) return null;
  const version = asNullableString(
    /** @type {Record<string, unknown>} */ (media).version
  );
  return { acknowledgedAt, version };
}

/**
 * Plain object clone of notification_prefs for merge (no arrays / non-objects).
 * @param {unknown} prefs
 * @returns {Record<string, unknown>}
 */
export function asPrefsObject(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return {};
  return { .../** @type {Record<string, unknown>} */ (prefs) };
}

/**
 * Build merged notification_prefs for a Connect self-service PATCH action.
 * @param {unknown} existingPrefs
 * @param {'complete_onboarding' | 'acknowledge_media_notice'} action
 * @param {string} [nowIso]
 * @returns {Record<string, unknown>}
 */
export function buildMergedPrefsForAction(existingPrefs, action, nowIso) {
  const merged = asPrefsObject(existingPrefs);
  const stamp =
    typeof nowIso === 'string' && nowIso.trim()
      ? nowIso.trim()
      : new Date().toISOString();

  if (action === 'complete_onboarding') {
    const prevOnboarding =
      merged.onboarding && typeof merged.onboarding === 'object' && !Array.isArray(merged.onboarding)
        ? { .../** @type {Record<string, unknown>} */ (merged.onboarding) }
        : {};
    merged.onboarding = {
      ...prevOnboarding,
      path: 'connect',
      completedAt: stamp,
    };
    return merged;
  }

  if (action === 'acknowledge_media_notice') {
    merged.mediaNotice = {
      acknowledgedAt: stamp,
      version: MEDIA_NOTICE_VERSION,
    };
    return merged;
  }

  return merged;
}

/**
 * Parse Connect PATCH body — only { action } allowed.
 * @param {unknown} body
 * @returns {{ ok: true, action: 'complete_onboarding' | 'acknowledge_media_notice' } | { ok: false, reason: string }}
 */
export function parseMemberSelfPatchCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_body' };
  }
  /** @type {Record<string, unknown>} */
  const b = body;
  const keys = Object.keys(b);
  if (keys.length !== 1 || keys[0] !== 'action') {
    return { ok: false, reason: keys.length === 0 ? 'invalid_body' : 'extra_fields' };
  }
  const action = asNullableString(b.action);
  if (!action || !MEMBER_SELF_PATCH_ACTIONS.includes(action)) {
    return { ok: false, reason: 'unknown_action' };
  }
  return {
    ok: true,
    action: /** @type {'complete_onboarding' | 'acknowledge_media_notice'} */ (action),
  };
}

/**
 * Map a single Vault users row to Connect member DTO.
 * @param {unknown} row
 * @returns {{ ok: true, member: object } | { ok: false, reason: string }}
 */
export function sanitizeVaultUserRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, reason: 'invalid_row' };
  }
  /** @type {Record<string, unknown>} */
  const r = row;
  const id = asNullableString(r.id);
  if (!id || !UUID_RE.test(id)) {
    return { ok: false, reason: 'invalid_id' };
  }

  const roleRaw = asNullableString(r.role) || 'PENDING';
  const role = roleRaw.toUpperCase();
  const approvalStatus = approvalStatusFromRole(role);

  return {
    ok: true,
    member: {
      id,
      name: asNullableString(r.name),
      email: sanitizeEmail(r.email),
      avatarUrl: sanitizeAvatarUrl(r.avatar_url),
      role,
      approvalStatus,
      mediaNotice: sanitizeMediaNotice(r.notification_prefs),
    },
  };
}

/**
 * Parse Vault PATCH users response: { ok: true, user: row }
 * @param {unknown} body
 * @returns {{ kind: 'member', member: object } | { kind: 'invalid', reason: string }}
 */
export function parseVaultUserPatchResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { kind: 'invalid', reason: 'not_object' };
  }
  /** @type {Record<string, unknown>} */
  const b = body;
  if (!b.user) {
    return { kind: 'invalid', reason: 'missing_user' };
  }
  const sanitized = sanitizeVaultUserRow(b.user);
  if (!sanitized.ok) {
    return { kind: 'invalid', reason: sanitized.reason };
  }
  return { kind: 'member', member: sanitized.member };
}

/**
 * Parse Vault JSON body for self-user.
 * Expected: { ok: true, users: [row] } or { ok: true, users: [] }
 * @param {unknown} body
 * @returns {{ kind: 'member', member: object } | { kind: 'missing' } | { kind: 'invalid', reason: string }}
 */
export function parseVaultSelfUserResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { kind: 'invalid', reason: 'not_object' };
  }
  /** @type {Record<string, unknown>} */
  const b = body;
  const users = b.users;
  if (!Array.isArray(users)) {
    return { kind: 'invalid', reason: 'missing_users' };
  }
  if (users.length === 0) {
    return { kind: 'missing' };
  }
  const sanitized = sanitizeVaultUserRow(users[0]);
  if (!sanitized.ok) {
    return { kind: 'invalid', reason: sanitized.reason };
  }
  return { kind: 'member', member: sanitized.member };
}

/**
 * @param {unknown} header
 * @returns {{ ok: true, token: string } | { ok: false, reason: string }}
 */
export function parseBearerAuthorization(header) {
  if (header == null) return { ok: false, reason: 'missing' };
  const raw = Array.isArray(header) ? String(header[0] || '') : String(header);
  const match = raw.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, reason: 'malformed' };
  const token = match[1];
  // JWT-shaped (3 segments) — reject placeholders
  if (!token || token === 'undefined' || token === 'active' || token === 'null') {
    return { ok: false, reason: 'invalid' };
  }
  if (token.split('.').length !== 3) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, token };
}
