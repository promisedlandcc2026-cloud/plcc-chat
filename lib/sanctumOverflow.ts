/** PLCC Sanctum's overflow room, offered when a Jordan prayer room is full (50 seats). */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SANCTUM_ORIGIN = String(env.VITE_SANCTUM_ORIGIN || 'https://plcc-sanctum.onrender.com').replace(/\/+$/, '');

export interface SanctumOverflow {
  available: boolean;
  roomName?: string;
  joinUrl?: string;
  /** The overflow room is relaying this Jordan room's live audio. */
  hearsJordan?: boolean;
}

/** Only follow links back to PLCC Sanctum itself. */
function safeJoinUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(SANCTUM_ORIGIN).origin && parsed.pathname.startsWith('/join/') ? parsed.toString() : undefined;
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
    if (body.available !== true || !joinUrl) return { available: false };
    return {
      available: true,
      joinUrl,
      roomName: typeof body.roomName === 'string' ? body.roomName.slice(0, 120) : 'Overflow prayer room',
      hearsJordan: body.hearsJordan === true,
    };
  } catch {
    return { available: false };
  }
}

/** LiveKit's own wording when a room is at its participant cap (backup for a join race). */
export function isRoomFullError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message || err || '').toLowerCase();
  return /max(imum)? participants|room is full|room full|exceeded its max/.test(msg);
}

/** Open the overflow in a new tab so Jordan stays open; same tab if the browser blocks it. */
export function openSanctumOverflow(joinUrl: string) {
  const tab = window.open(joinUrl, '_blank');
  if (tab) tab.opener = null;
  else window.location.assign(joinUrl);
}
