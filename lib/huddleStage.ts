/**
 * Ka Link Phase 2 (Nov 2026) — client view of the moderator "stage" rules and
 * the first-come, first-served hand queue. Pure functions (unit tested).
 */

export type HuddleStageView = { micLock: boolean; readerIds: string[] };

/** PLCC (Nov 25 2026): every Ka Link starts with mics OPEN; moderators can still lock them. */
export const EMPTY_HUDDLE_STAGE: HuddleStageView = { micLock: false, readerIds: [] };

/** The moderator who opened this Ka Link (session host), from LiveKit room metadata. */
export function parseHuddleHostId(roomMetadata: string | undefined | null): string | null {
  if (!roomMetadata) return null;
  try {
    const parsed = JSON.parse(roomMetadata);
    const id = parsed && typeof parsed === 'object' ? parsed.hostId : null;
    return typeof id === 'string' && id.length > 0 && id.length <= 128 ? id : null;
  } catch {
    return null;
  }
}

/** Read `stage` from LiveKit room metadata (written by Canaan). */
export function parseHuddleStageView(roomMetadata: string | undefined | null): HuddleStageView {
  if (!roomMetadata) return EMPTY_HUDDLE_STAGE;
  try {
    const parsed = JSON.parse(roomMetadata);
    const stage = parsed && typeof parsed === 'object' ? parsed.stage : null;
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return EMPTY_HUDDLE_STAGE;
    const readerIds = Array.isArray(stage.readerIds)
      ? stage.readerIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0).slice(0, 12)
      : [];
    return { micLock: stage.micLock === true, readerIds };
  } catch {
    return EMPTY_HUDDLE_STAGE;
  }
}

/** When this person raised their hand (ms), from participant metadata; null if not raised. */
export function parseHandRaisedAt(metadata: string | undefined | null): number | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (!parsed?.handRaised) return null;
    const at = Number(parsed.raisedAt);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/**
 * Raised hands in the order they went up (#6). `firstSeen` holds when this
 * device first saw a hand without a time, so it still keeps its place.
 */
export function orderRaisedHands<T extends { identity: string; handRaised: boolean; raisedAt?: number | null; handNo?: number | null }>(
  tiles: T[],
  firstSeen: Map<string, number>,
  now: number = Date.now()
): T[] {
  const raised = tiles.filter((t) => t.handRaised);
  // Forget people whose hand is down so a new raise goes to the back of the line.
  const up = new Set(raised.map((t) => t.identity));
  for (const id of Array.from(firstSeen.keys())) if (!up.has(id)) firstSeen.delete(id);
  for (const t of raised) if (!firstSeen.has(t.identity)) firstSeen.set(t.identity, t.raisedAt ?? now);
  return [...raised].sort((a, b) => {
    // Fixed hand numbers (kept for the whole Ka Link) decide the line when both have one.
    if (a.handNo && b.handNo && a.handNo !== b.handNo) return a.handNo - b.handNo;
    const ta = a.raisedAt ?? firstSeen.get(a.identity) ?? now;
    const tb = b.raisedAt ?? firstSeen.get(b.identity) ?? now;
    return ta - tb || a.identity.localeCompare(b.identity);
  });
}

export const HUDDLE_MIC_LOCKED_NOTICE = 'Mics are locked. Raise your hand and a moderator will let you speak.';
export const HUDDLE_MIC_ALLOWED_NOTICE = 'A moderator let you speak. Tap Unmute when you are ready.';
