/**
 * Coming back to Ka Link from another app (WhatsApp, a text, the camera…).
 *
 * The bug: a member joins, switches to WhatsApp, comes back — and hears nothing.
 * The call is still connected and sound is still arriving, but the phone has
 * stopped *playing* it (another app took the speaker; iPhones keep the old audio
 * player "playing" with no sound). Leaving and rejoining was the only fix.
 *
 * On return we now do what a rejoin does, without hanging up:
 *  - rebuild the audio players with fresh elements,
 *  - after a longer absence, re-subscribe every voice (fresh media from LiveKit),
 *  - on iPhones/iPads, ask for one tap (any tap on the screen counts) — Apple
 *    only lets a web app use the speaker again after a touch.
 */

/** Shorter than this (a notification pull-down) and nothing is rebuilt. */
export const RETURN_MIN_AWAY_MS = 2_000;
/** Away at least this long: re-subscribe every voice, not just rebuild players. */
export const RETURN_RESUBSCRIBE_AWAY_MS = 8_000;

export type ReturnPlan = {
  /** Replace each voice's audio element with a new one. */
  rebuild: boolean;
  /** Re-subscribe every unmuted voice (off → on). */
  resubscribe: boolean;
  /** Show "Tap to hear the prayer" (any tap fixes it). */
  askTap: boolean;
};

export function returnPlan(awayMs: number, appleMobile: boolean): ReturnPlan {
  if (!Number.isFinite(awayMs) || awayMs < RETURN_MIN_AWAY_MS) {
    return { rebuild: false, resubscribe: false, askTap: false };
  }
  return {
    rebuild: true,
    resubscribe: awayMs >= RETURN_RESUBSCRIBE_AWAY_MS,
    askTap: appleMobile,
  };
}

/** iPhone, iPad (including iPads that say "Macintosh"), iPod. */
export function isAppleMobile(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined =
  typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as a Mac; a Mac has no touch screen.
  return /Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}
