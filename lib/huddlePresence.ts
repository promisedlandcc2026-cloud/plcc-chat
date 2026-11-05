/** Shared Live Huddle presence helpers (community + family). */

/** Shown when Vault (or a huddle host) server-mutes this member. */
export const HUDDLE_HOST_MUTE_NOTICE = 'A huddle host muted your microphone.';

/**
 * LiveKit canPublishSources empty/missing = all sources allowed.
 * After a host mute, Vault removes MICROPHONE from the list.
 */
export function huddleMicrophonePublishAllowed(
  permissions: { canPublishSources?: unknown } | null | undefined
): boolean {
  const sources = permissions?.canPublishSources;
  if (!Array.isArray(sources) || sources.length === 0) return true;
  return sources.some((source) => String(source).toUpperCase().includes('MICROPHONE'));
}

export type HuddleTileSnapshot = {
  identity: string;
  name: string;
  isLocal: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
};

export type HuddleRosterEntry = HuddleTileSnapshot & {
  status: 'in' | 'left';
  joinedAt: number;
  leftAt: number | null;
};

export function parseHandRaised(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as { handRaised?: unknown };
    return Boolean(parsed?.handRaised);
  } catch {
    return false;
  }
}

export function mergeHandMetadata(
  existing: string | undefined,
  handRaised: boolean
): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...parsed };
      }
    } catch {
      /* ignore */
    }
  }
  return JSON.stringify({
    ...base,
    v: 1,
    handRaised,
    raisedAt: handRaised ? Date.now() : null,
  });
}

/** Raised hands first, then local, then name. */
export function sortTilesRaisedFirst<T extends HuddleTileSnapshot>(tiles: T[]): T[] {
  return [...tiles].sort((a, b) => {
    if (a.handRaised !== b.handRaised) return a.handRaised ? -1 : 1;
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function syncRosterFromTiles(
  prev: HuddleRosterEntry[],
  tiles: HuddleTileSnapshot[],
  now = Date.now()
): HuddleRosterEntry[] {
  const byId = new Map(prev.map((e) => [e.identity, e]));
  const present = new Set(tiles.map((t) => t.identity));

  for (const tile of tiles) {
    const existing = byId.get(tile.identity);
    byId.set(tile.identity, {
      identity: tile.identity,
      name: tile.name,
      isLocal: tile.isLocal,
      micOn: tile.micOn,
      camOn: tile.camOn,
      handRaised: tile.handRaised,
      status: 'in',
      joinedAt: existing?.joinedAt ?? now,
      leftAt: null,
    });
  }

  for (const [id, entry] of byId) {
    if (!present.has(id) && entry.status === 'in') {
      byId.set(id, { ...entry, status: 'left', leftAt: now, handRaised: false });
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'in' ? -1 : 1;
    if (a.handRaised !== b.handRaised) return a.handRaised ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function markRosterLeft(
  prev: HuddleRosterEntry[],
  identity: string,
  now = Date.now()
): HuddleRosterEntry[] {
  return prev.map((e) =>
    e.identity === identity
      ? { ...e, status: 'left', leftAt: now, handRaised: false }
      : e
  );
}

export function leftAgoLabel(leftAt: number | null, now = Date.now()): string {
  if (!leftAt) return 'Left';
  const mins = Math.max(0, Math.floor((now - leftAt) / 60000));
  if (mins < 1) return 'Left just now';
  if (mins === 1) return 'Left 1m ago';
  if (mins < 60) return `Left ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? 'Left 1h ago' : `Left ${hours}h ago`;
}
