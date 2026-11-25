/**
 * The overflow room, used when a PLCC Ka Link prayer room is full.
 *
 * Nov 25 2026: members are moved straight into the overflow room (same tab, same look as
 * Ka Link). No entrance page, no second name prompt. The overflow room itself is served
 * by PLCC Sanctum behind the scenes; members only ever see "PLCC Ka Link · Overflow".
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SANCTUM_ORIGIN = String(env.VITE_SANCTUM_ORIGIN || 'https://plcc-sanctum.onrender.com').replace(/\/+$/, '');

export const OVERFLOW_DASHBOARD_URL = new URL('/dashboard', SANCTUM_ORIGIN).href;

export type SanctumOverflow = { available: false } | { available: true; joinUrl: string };

/** Only follow links back to the overflow room itself. */
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
    const joinUrl = safeJoinUrl(body.joinUrl);
    if (body.available !== true || body.hearsJordan !== true || !joinUrl) {
      return { available: false };
    }
    const direct = new URL(joinUrl);
    direct.searchParams.set('from', 'jordan');
    direct.searchParams.set('channel', jordanChannelId);
    return { available: true, joinUrl: direct.href };
  } catch {
    return { available: false };
  }
}

/**
 * Where to send the member: the overflow room, joining automatically. Their name travels in
 * the #fragment (never sent to a server) and the overflow room removes it from the address bar.
 */
export function overflowMoveHref(joinUrl: string, memberName?: string | null): string {
  const url = new URL(joinUrl);
  url.searchParams.set('auto', '1');
  const name = String(memberName || '').trim().slice(0, 60);
  url.hash = name.length >= 2 ? `n=${encodeURIComponent(name)}` : '';
  return url.href;
}

/** LiveKit's own wording when a room is at its participant cap (backup for a join race). */
export function isRoomFullError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message || err || '').toLowerCase();
  return /max(imum)? participants|room is full|room full|exceeded its max/.test(msg);
}
