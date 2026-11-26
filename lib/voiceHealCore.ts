/** Pure rules for the voice watchdog (lib/voiceHeal.ts) — no LiveKit import, easy to test. */
export const VOICE_HEAL_INTERVAL_MS = 4_000;
/** Checks in a row with no new packets before we heal (3 × 4s ≈ 12s of silence on the wire). */
export const VOICE_STALL_CHECKS = 3;
/** Checks in a row "wanted but not subscribed" before we re-subscribe. */
export const VOICE_UNSUBSCRIBED_CHECKS = 2;
export const VOICE_HEAL_COOLDOWN_MS = 20_000;

export type StallState = { last: number | null; stalls: number };

/** Pure: count checks in a row where the packet counter didn't move. */
export function nextStall(prev: StallState, packets: number | undefined): StallState {
  if (packets === undefined || !Number.isFinite(packets)) return { last: prev.last, stalls: 0 };
  if (prev.last === null || packets > prev.last) return { last: packets, stalls: 0 };
  // Counter reset (new track/transport) counts as fresh, not a stall.
  if (packets < prev.last) return { last: packets, stalls: 0 };
  return { last: packets, stalls: prev.stalls + 1 };
}

/** Pure: may this voice be healed now? */
export function mayHeal(lastHealAt: number | undefined, now: number, cooldownMs = VOICE_HEAL_COOLDOWN_MS): boolean {
  return lastHealAt === undefined || now - lastHealAt >= cooldownMs;
}
