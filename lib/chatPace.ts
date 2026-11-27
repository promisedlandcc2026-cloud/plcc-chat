/**
 * Pacing for chat-room traffic (Nov 27, 2026 audit, after the "Seen by" outage).
 * In a busy room every phone hears every new message. These keep each phone's
 * follow-up requests small and spread out, so the server load grows gently with
 * the room size instead of spiking all at once.
 */
/** A new message arrived: reload once after a short random wait (bursts share one reload). */
export const RELOAD_MIN_MS = 300;
export const RELOAD_SPREAD_MS = 1_700;
/** Live connection down: how often to check for new messages. */
export const FALLBACK_POLL_MS = 15_000;
/** "Mark read" (unread counts) at most this often per room. */
export const MARK_READ_GAP_MS = 15_000;

export function reloadDelayMs(random: number): number {
  return RELOAD_MIN_MS + Math.round(Math.max(0, Math.min(1, random)) * RELOAD_SPREAD_MS);
}

export function markReadDue(lastAt: number, now: number): boolean {
  return !lastAt || now - lastAt >= MARK_READ_GAP_MS;
}

/** A background check every `baseMs`, nudged ±20% so thousands of phones don't line up. */
export function jittered(baseMs: number, random: number): number {
  return Math.round(baseMs * (0.8 + 0.4 * Math.max(0, Math.min(1, random))));
}
