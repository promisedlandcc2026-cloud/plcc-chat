import { isSupabaseConfigured, supabase } from './supabase';

export type IntercessorPrayer = {
  id: string;
  name: string;
  category: string;
  content: string;
  createdAt: string;
  onWall: boolean;
  privateToIntercessors?: boolean;
  prayedAt: string | null;
  prayedBy: string | null;
  answeredAt: string | null;
};

export type IntercessorsAccess = {
  allowed: boolean;
  setUp: boolean;
  canLead: boolean;
  ministryName: string | null;
  roomId: string | null;
};

export type PrayerWatchList = {
  ministryName: string | null;
  roomId: string | null;
  canLead: boolean;
  watchReady: boolean;
  items: IntercessorPrayer[];
};

export class IntercessorsError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseConfigured) throw new IntercessorsError('Please sign in again to continue.', 401);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token || token.split('.').length !== 3) throw new IntercessorsError('Please sign in again to continue.', 401);
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    const headers = { ...(await authHeaders()), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) };
    res = await fetch(url, { ...init, headers, cache: 'no-store' });
  } catch (err) {
    if (err instanceof IntercessorsError) throw err;
    throw new IntercessorsError('No connection. Please try again.');
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || data.ok !== true) {
    throw new IntercessorsError(String(data?.message || 'We couldn’t load the Prayer Watch. Please try again.'), res.status);
  }
  return data;
}

function toList(d: Record<string, unknown>): PrayerWatchList {
  return {
    ministryName: (d.ministryName as string) || null,
    roomId: (d.roomId as string) || null,
    canLead: d.canLead === true,
    watchReady: d.watchReady !== false,
    items: (d.items as IntercessorPrayer[]) || [],
  };
}

/** Can this member open the Prayer Watch? */
export async function fetchIntercessorsAccess(): Promise<IntercessorsAccess> {
  const d = await call('/api/intercessors?action=access');
  return {
    allowed: d.allowed === true,
    setUp: d.setUp === true,
    canLead: d.canLead === true,
    ministryName: (d.ministryName as string) || null,
    roomId: (d.roomId as string) || null,
  };
}

/** Shared prayer requests between two dates (never Pastor-only ones), newest first, without answered ones. */
export async function fetchIntercessorPrayers(from: Date, to: Date): Promise<PrayerWatchList> {
  const qs = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  return toList(await call(`/api/intercessors?${qs}`));
}

/** Praise reports: prayers the head of the Intercessors marked Answered. */
export async function fetchAnsweredPrayers(): Promise<PrayerWatchList> {
  return toList(await call('/api/intercessors?view=answered'));
}

/** Remove a prayer request for good (head of the Intercessors / prayer team). */
export async function removePrayer(id: string): Promise<void> {
  await call('/api/intercessors', { method: 'POST', body: JSON.stringify({ action: 'remove', id }) });
}

/** Make sure the viewer is in the Intercessor Channel before joining its Live Huddle. */
export async function joinWatchRoom(): Promise<void> {
  await call('/api/intercessors', { method: 'POST', body: JSON.stringify({ action: 'join-room' }) });
}

/** Mark (or unmark) a request Prayed or Answered. */
export async function markPrayer(action: 'prayed' | 'answered', id: string, value: boolean): Promise<void> {
  await call('/api/intercessors', { method: 'POST', body: JSON.stringify({ action, id, value }) });
}
