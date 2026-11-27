/**
 * Outage fallbacks kept on the phone (Nov 27, 2026). When Canaan or its database is
 * down, Ka Link uses these so members can still reach the prayer rooms:
 *  - the member's last confirmed membership (never used for "not a member" or "signed out"),
 *  - the prayer room list, so the Join buttons still show.
 * Saved per account; never shared between accounts on the same phone.
 */
import type { ConnectMemberIdentity } from './authTypes';

const IDENTITY_KEY = 'plcc-ka-link-identity-v1';
const ROOMS_KEY = 'plcc-ka-link-prayer-rooms-v1';
export const IDENTITY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const ROOMS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Errors that mean "couldn't reach the server", not "you're not allowed". */
const OUTAGE_CODES = new Set(['vault_unavailable', 'network', 'bridge_unconfigured', 'rate_limited', 'malformed_response', 'invalid_upstream']);
export function isOutageCode(code: string | null | undefined): boolean {
  return OUTAGE_CODES.has(String(code || ''));
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: fallbacks are best-effort */
  }
}

type SavedIdentity = { userId: string; at: number; identity: ConnectMemberIdentity };

export function saveIdentity(userId: string, identity: ConnectMemberIdentity, now = Date.now()) {
  if (!userId || identity?.approvalStatus !== 'approved') return;
  write(IDENTITY_KEY, { userId, at: now, identity } satisfies SavedIdentity);
}

export function readSavedIdentity(userId: string, now = Date.now()): ConnectMemberIdentity | null {
  const saved = read<SavedIdentity>(IDENTITY_KEY);
  if (!saved || saved.userId !== userId || !saved.identity) return null;
  if (now - Number(saved.at || 0) > IDENTITY_MAX_AGE_MS) return null;
  return saved.identity.approvalStatus === 'approved' ? saved.identity : null;
}

export function forgetSavedIdentity() {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* ignore */
  }
}

export type SavedPrayerRoom = { channelId: string; name: string };
type SavedRooms = { userId: string; at: number; rooms: SavedPrayerRoom[] };

export function savePrayerRooms(userId: string, rooms: SavedPrayerRoom[], now = Date.now()) {
  if (!userId) return;
  const clean = rooms
    .filter((r) => r && typeof r.channelId === 'string' && typeof r.name === 'string')
    .slice(0, 12)
    .map((r) => ({ channelId: r.channelId, name: r.name.slice(0, 80) }));
  write(ROOMS_KEY, { userId, at: now, rooms: clean } satisfies SavedRooms);
}

export function readSavedPrayerRooms(userId: string, now = Date.now()): SavedPrayerRoom[] {
  const saved = read<SavedRooms>(ROOMS_KEY);
  if (!saved || saved.userId !== userId || !Array.isArray(saved.rooms)) return [];
  if (now - Number(saved.at || 0) > ROOMS_MAX_AGE_MS) return [];
  return saved.rooms;
}
