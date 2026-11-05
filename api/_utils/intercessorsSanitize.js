/**
 * Intercessors prayer list — query parsing, Vault response cleanup, and meeting days.
 * The Intercessors meet every Tuesday and Friday.
 */

export const MEETING_DAYS = [2, 5]; // Tuesday, Friday (Date#getDay)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function roomId(v) {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/**
 * @param {Record<string, unknown>} query
 * @returns {{ ok: true, action?: 'access', from?: string, to?: string } | { ok: false }}
 */
export function parseIntercessorsQuery(query) {
  const q = query || {};
  if (String(q.action || '') === 'access') return { ok: true, action: 'access' };
  if (String(q.view || '') === 'answered') return { ok: true, view: 'answered' };
  const out = { ok: true };
  for (const key of ['from', 'to']) {
    const raw = q[key];
    if (raw == null || raw === '') continue;
    const v = String(raw);
    if (v.length > 40 || !ISO_RE.test(v) || Number.isNaN(new Date(v).getTime())) return { ok: false };
    out[key] = v;
  }
  return out;
}

/** @param {unknown} body */
export function parseVaultIntercessorsAccess(body) {
  const b = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};
  return {
    ok: true,
    allowed: b.allowed === true,
    setUp: b.setUp === true,
    ministryName: str(b.ministryName, 120) || null,
    roomId: roomId(b.roomId),
    canLead: b.canLead === true,
  };
}

/**
 * Prayer Watch mark from the browser: { action: 'prayed' | 'answered', id, value }.
 * @param {unknown} body
 */
export function parsePrayerMarkCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  const keys = Object.keys(b);
  // Join the Intercessor Channel before its Live Huddle (server decides who may).
  if (b.action === 'join-room' && keys.length === 1) return { action: 'join-room' };
  // Remove a request (server checks the head of the Intercessors / prayer team).
  if (b.action === 'remove') {
    if (keys.length !== 2 || typeof b.id !== 'string' || !UUID_RE.test(b.id)) return null;
    return { action: 'remove', id: b.id };
  }
  if (keys.some((k) => !['action', 'id', 'value'].includes(k))) return null;
  if (b.action !== 'prayed' && b.action !== 'answered') return null;
  if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) return null;
  if (typeof b.value !== 'boolean') return null;
  return { action: b.action, id: b.id, value: b.value };
}

/** @param {unknown} body */
export function parseVaultIntercessorsList(body) {
  if (!body || typeof body !== 'object') return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  if (!Array.isArray(b.items)) return null;
  const items = b.items
    .filter((it) => it && typeof it === 'object')
    .slice(0, 500)
    .map((it) => {
      const r = /** @type {Record<string, unknown>} */ (it);
      return {
        id: str(r.id, 64),
        name: str(r.name, 80) || 'Anonymous',
        category: str(r.category, 40) || 'Other',
        content: str(r.content, 2000),
        createdAt: str(r.createdAt, 40),
        onWall: r.onWall === true,
        privateToIntercessors: r.privateToIntercessors === true,
        prayedAt: str(r.prayedAt, 40) || null,
        prayedBy: str(r.prayedBy, 40) || null,
        answeredAt: str(r.answeredAt, 40) || null,
      };
    })
    .filter((it) => it.id && it.content);
  return {
    ok: true,
    ministryName: str(b.ministryName, 120) || null,
    roomId: roomId(b.roomId),
    canLead: b.canLead === true,
    watchReady: b.watchReady !== false,
    view: b.view === 'answered' ? 'answered' : 'requests',
    from: str(b.from, 40),
    to: str(b.to, 40),
    items,
  };
}

/**
 * Start (00:00 local) of the last meeting day before today.
 * On a Tuesday this is the Friday before, so the list covers everything since the last meeting.
 * @param {Date} [now]
 */
export function lastMeetingStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 1; i <= 7; i += 1) {
    const c = new Date(d);
    c.setDate(d.getDate() - i);
    if (MEETING_DAYS.includes(c.getDay())) return c;
  }
  return new Date(d.getTime() - 7 * 86400000);
}

/**
 * Next meeting day, counting today.
 * @param {Date} [now]
 */
export function nextMeetingDay(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 7; i += 1) {
    const c = new Date(d);
    c.setDate(d.getDate() + i);
    if (MEETING_DAYS.includes(c.getDay())) return c;
  }
  return d;
}
