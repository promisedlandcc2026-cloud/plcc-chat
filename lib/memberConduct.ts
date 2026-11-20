/**
 * Member conduct (Nov 19 2026): moderators warn an unruly member first; if it
 * continues they block them (calls, chat and Tribes posts) until a leader unblocks
 * in Canaan → Blocked members. Canaan decides who may do this.
 * Shared by Ka Link and PLCC Tribes (same file in both apps).
 */
import { supabase } from './supabase';

export type ConductPlace = 'call' | 'chat' | 'post';

export type ConductStatus = {
  blocked: boolean;
  blockedAt: string | null;
  blockReason: string | null;
  warnedAt: string | null;
  warnReason: string | null;
  warnings: number;
};

export type ConductTarget = {
  userId: string;
  name: string;
  place: ConductPlace;
  channelId?: string | null;
  postId?: string | null;
};

/** Live notice the call sends to the member (topic plcc.conduct). */
export const HUDDLE_CONDUCT_TOPIC = 'plcc.conduct';
export type ConductNotice = { t: 'warn' | 'block' | 'ask-unmute'; reason?: string | null; by?: string | null };

/** Quick reasons — big buttons for moderators on phones. */
export const WARN_REASONS = [
  'Disrupting the prayer',
  'Unkind or rude words',
  'Inappropriate language',
  'Posting off-topic or spam',
];

export const MEMBER_BLOCKED_CODE = 'member_blocked';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isConductTargetId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

export function parseConductNotice(payload: Uint8Array | string): ConductNotice | null {
  try {
    const raw = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    const v = JSON.parse(raw);
    if (!v || (v.t !== 'warn' && v.t !== 'block' && v.t !== 'ask-unmute')) return null;
    return {
      t: v.t,
      reason: typeof v.reason === 'string' ? v.reason.slice(0, 200) : null,
      by: typeof v.by === 'string' ? v.by.slice(0, 80) : null,
    };
  } catch {
    return null;
  }
}

async function token(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

async function call(method: 'GET' | 'POST', qs: string, body?: unknown): Promise<any> {
  const t = await token();
  if (!t) throw new Error('Please sign in again.');
  const res = await fetch(`/api/community-chat?resource=member-conduct${qs}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${t}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok !== true) throw new Error(String(data?.message || 'That did not work. Please try again.'));
  return data;
}

/** Can I warn/block here? (Tribes posts: no room, so any moderator/leader.) */
export async function canModerateConduct(channelId?: string | null): Promise<boolean> {
  try {
    const d = await call('GET', `&can=1${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}`);
    return d.canModerate === true;
  } catch {
    return false;
  }
}

let canModeratePosts: Promise<boolean> | null = null;
/** Tribes posts / comments (no room): may I warn or block? Asked once per visit. */
export function canModerateConductCached(): Promise<boolean> {
  if (!canModeratePosts) canModeratePosts = canModerateConduct(null);
  return canModeratePosts;
}

export async function fetchConductStatus(userId: string, channelId?: string | null): Promise<ConductStatus> {
  const d = await call('GET', `&targetUserId=${encodeURIComponent(userId)}${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}`);
  return d.status as ConductStatus;
}

export async function warnMember(target: ConductTarget, reason: string | null): Promise<ConductStatus> {
  const d = await call('POST', '', { action: 'warn', targetUserId: target.userId, reason, place: target.place, channelId: target.channelId || null, postId: target.postId || null });
  return d.status as ConductStatus;
}

export async function blockMember(target: ConductTarget, reason: string | null): Promise<ConductStatus> {
  const d = await call('POST', '', { action: 'block', targetUserId: target.userId, reason, place: target.place, channelId: target.channelId || null, postId: target.postId || null });
  return d.status as ConductStatus;
}
