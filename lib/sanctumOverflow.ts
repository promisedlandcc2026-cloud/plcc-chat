/** PLCC Sanctum's overflow room, offered when a PLCC Ka Link prayer room is full (50 seats). */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SANCTUM_ORIGIN = String(env.VITE_SANCTUM_ORIGIN || 'https://plcc-sanctum.onrender.com').replace(/\/+$/, '');

const OVERFLOW_ORIGIN = env.VITE_PLCC_OVERFLOW_ORIGIN || 'https://plcc-overflow.vercel.app';
export const OVERFLOW_DASHBOARD_URL = new URL('/dashboard', SANCTUM_ORIGIN).href;

export type SanctumOverflow = { available: false } | { available: true; joinUrl: string };

/** Only follow links back to PLCC Sanctum itself. */
function safeJoinUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(SANCTUM_ORIGIN).origin && /^\/join\/[^/]+$/.test(parsed.pathname) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function findSanctumOverflow(jordanChannelId: string): Promise<SanctumOverflow> {
  try {
    const res = await fetch(`${SANCTUM_ORIGIN}/api/overflow?jordanChannelId=${encodeURIComponent(jordanChannelId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { available: false };
    const body = (await res.json()) as Record<string, unknown>;
    if (body.available !== true || body.hearsJordan !== true || !safeJoinUrl(body.joinUrl)) {
      return { available: false };
    }
    const entrance = new URL('/', OVERFLOW_ORIGIN);
    entrance.searchParams.set('channel', jordanChannelId);
    return { available: true, joinUrl: entrance.href };
  } catch {
    return { available: false };
  }
}

/** LiveKit's own wording when a room is at its participant cap (backup for a join race). */
export function isRoomFullError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message || err || '').toLowerCase();
  return /max(imum)? participants|room is full|room full|exceeded its max/.test(msg);
}
