/** Shared Live Huddle presence helpers (community + family). */

/** Shown when Vault (or a huddle host) server-mutes this member. */
export const HUDDLE_HOST_MUTE_NOTICE = 'A Ka Link host muted your microphone.';

/** Classify only recognized device failures. Never copy raw browser errors into issue reports. */
export function huddleMicrophoneFailure(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { reason: 'permission_denied', message: 'Microphone access is blocked. Allow microphone access for Ka Link in your browser and phone settings, then try Unmute again.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { reason: 'device_not_found', message: 'No microphone was found. Check that your microphone is connected, then try Unmute again.' };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { reason: 'device_unavailable', message: 'Ka Link could not start your microphone. End any other call using it, then try Unmute again.' };
    default:
      return { reason: 'unknown', message: 'Ka Link could not turn on your microphone. Try Unmute again, or leave and rejoin the room.' };
  }
}


/**
 * LiveKit canPublishSources empty/missing = all sources allowed.
 * After a host mute, Vault removes MICROPHONE from the list.
 */
export function huddleMicrophonePublishAllowed(
  permissions: { canPublishSources?: unknown } | null | undefined
): boolean {
  const sources = permissions?.canPublishSources;
  if (!Array.isArray(sources) || sources.length === 0) return true;
  // LiveKit sends these as numbers on the wire (TrackSource.MICROPHONE = 2); older code used names.
  return sources.some((source) => source === 2 || String(source).toUpperCase().includes('MICROPHONE'));
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

/**
 * This person's hand number for the Ka Link (given the first time they raise a hand).
 * It stays theirs for the session — lowering (by them or a moderator) keeps it, and it
 * never shifts when other hands go down. Null if they haven't raised a hand yet.
 */
export function parseHandNo(metadata: string | undefined | null): number | null {
  if (!metadata) return null;
  try {
    const n = Number(JSON.parse(metadata)?.handNo);
    return Number.isInteger(n) && n > 0 && n < 100000 ? n : null;
  } catch {
    return null;
  }
}

/** The next free hand number: one more than the highest number anyone in the room holds. */
export function nextHandNo(metadatas: Array<string | undefined | null>): number {
  let max = 0;
  for (const m of metadatas) max = Math.max(max, parseHandNo(m) ?? 0);
  return max + 1;
}

export function mergeHandMetadata(
  existing: string | undefined,
  handRaised: boolean,
  handNo?: number | null
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
    // Keep the number they already have; set it on their first raise.
    ...(handNo ? { handNo } : {}),
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
