/**
 * Ka Link call session helpers (Phase 1 call stability, Nov 2026).
 *
 * - The active call is remembered on the device so that if the phone reloads
 *   the app (iPhone does this after a phone call or when memory is low) the
 *   member gets a one-tap "Rejoin Ka Link" instead of starting over.
 * - Reconnect waits grow on weak mobile data instead of giving up after 3 quick tries.
 *
 * Pure functions only, so they can be unit tested in Node.
 */

export const KA_LINK_SESSION_KEY = 'plcc_ka_link_active_v1';

/** How long after a drop we still offer "Rejoin Ka Link" (prayer sessions run long). */
export const KA_LINK_REJOIN_WINDOW_MS = 3 * 60 * 60 * 1000;

export type KaLinkSession = {
  channelId: string;
  channelName?: string;
  audioOnly?: boolean;
  /** When the member joined (ms since epoch). */
  at: number;
};

const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function parseKaLinkSession(raw: string | null | undefined, now: number = Date.now()): KaLinkSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const channelId = typeof o.channelId === 'string' ? o.channelId.trim() : '';
  if (!CHANNEL_ID_RE.test(channelId)) return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0;
  if (!at || at > now + 60_000 || now - at > KA_LINK_REJOIN_WINDOW_MS) return null;
  const channelName = typeof o.channelName === 'string' ? o.channelName.trim().slice(0, 120) : '';
  return {
    channelId,
    ...(channelName ? { channelName } : {}),
    ...(o.audioOnly === true ? { audioOnly: true } : {}),
    at,
  };
}

export function serializeKaLinkSession(session: KaLinkSession): string {
  return JSON.stringify({
    channelId: session.channelId,
    channelName: session.channelName || undefined,
    audioOnly: session.audioOnly ? true : undefined,
    at: session.at,
  });
}

/**
 * Waits between automatic rejoin attempts after an unexpected drop (~67 seconds in total).
 * If the phone is offline the call waits for the network to come back instead.
 */
export const KA_LINK_RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 3000, 5000, 8000, 10_000, 15_000, 23_000];

/** Delay before reconnect attempt `attempt` (0-based), or null when it is time to stop and ask. */
export function kaLinkReconnectDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  return attempt < KA_LINK_RECONNECT_DELAYS_MS.length ? KA_LINK_RECONNECT_DELAYS_MS[attempt] : null;
}

/** History marker: the Ka Link screen is open on top of the page underneath. */
export const KA_LINK_HISTORY_FLAG = 'plccKaLinkOpen';

export function historyStateHasKaLink(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>)[KA_LINK_HISTORY_FLAG] === true);
}

export function withKaLinkHistoryFlag(state: unknown): Record<string, unknown> {
  const base = state && typeof state === 'object' ? { ...(state as Record<string, unknown>) } : {};
  base[KA_LINK_HISTORY_FLAG] = true;
  return base;
}
