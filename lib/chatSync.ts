/**
 * Light chat reloads (Nov 28, 2026, before the Dec 6 launch).
 *
 * Every live ping names the message that changed (new, edited, reacted, photo
 * added, pinned, removed). Instead of reloading the whole conversation, a phone
 * asks Canaan for just those messages and merges them in. Background checks ask
 * only for messages newer than the newest one on screen, with a full refresh
 * now and then to pick up anything a ping missed.
 */
import type { CommunityChatMessage } from './communityChatTypes';

/** Messages kept on screen (same cap the server uses). */
export const CHAT_WINDOW = 200;
/** More pending ids than this in one wait → just reload the room. */
export const MAX_IDS_PER_FETCH = 50;
/** Background check: a full refresh at most this often, light checks in between. */
export const FULL_REFRESH_MS = 5 * 60_000;

function byTime(a: CommunityChatMessage, b: CommunityChatMessage): number {
  const ta = Date.parse(a.createdAt) || 0;
  const tb = Date.parse(b.createdAt) || 0;
  return ta - tb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Pure: replace changed messages, add new ones, keep time order and the last `cap`. */
export function mergeMessages(
  prev: CommunityChatMessage[],
  incoming: CommunityChatMessage[],
  cap = CHAT_WINDOW
): CommunityChatMessage[] {
  if (!incoming.length) return prev;
  const map = new Map(prev.map((m) => [m.id, m] as const));
  for (const m of incoming) map.set(m.id, { ...map.get(m.id), ...m });
  const next = [...map.values()].sort(byTime);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Pure: the newest message time on screen (cursor for "anything newer?"). */
export function newestCreatedAt(list: CommunityChatMessage[]): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const m of list) {
    const t = Date.parse(m.createdAt);
    if (Number.isFinite(t) && t > bestT) {
      bestT = t;
      best = m.createdAt;
    }
  }
  return best;
}

export type ReloadPlan =
  | { kind: 'full' }
  | { kind: 'light'; ids: string[]; after: string | null };

/** Pure: what to ask Canaan for, given the pings heard and what's on screen. */
export function planReload(opts: {
  pendingIds: ReadonlySet<string>;
  /** A ping without an id, a reconnect, or a background check: "anything newer?" */
  catchUp: boolean;
  messages: CommunityChatMessage[];
}): ReloadPlan {
  const cursor = newestCreatedAt(opts.messages);
  if (!cursor) return { kind: 'full' };
  if (opts.pendingIds.size > MAX_IDS_PER_FETCH) return { kind: 'full' };
  const after = opts.catchUp || opts.pendingIds.size === 0 ? cursor : null;
  return { kind: 'light', ids: [...opts.pendingIds], after };
}

/** Pure: should this background check be a full refresh? */
export function fullRefreshDue(lastFullAt: number, now: number): boolean {
  return !lastFullAt || now - lastFullAt >= FULL_REFRESH_MS;
}
