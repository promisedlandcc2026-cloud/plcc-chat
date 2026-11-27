/**
 * How long to wait before refreshing "Seen by" (✓✓) in a chat room.
 * At most once every READERS_MIN_GAP_MS per phone, plus a random spread so a busy
 * room's phones don't all ask the server in the same second.
 */
export const READERS_MIN_GAP_MS = 10_000;
export const READERS_SPREAD_MS = 5_000;

export function readersWaitMs(lastFetchAt: number, now: number, random: number): number {
  const spread = Math.round(Math.max(0, Math.min(1, random)) * READERS_SPREAD_MS);
  const sinceLast = now - lastFetchAt;
  const gap = lastFetchAt > 0 && sinceLast < READERS_MIN_GAP_MS ? READERS_MIN_GAP_MS - sinceLast : 0;
  return gap + 1_000 + spread;
}
