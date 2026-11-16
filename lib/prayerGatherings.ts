/**
 * The Prayer Gathering rooms shown on PLCC Ka Link's first tab, in order.
 * Each one is an ordinary chat room found by its name (any capitals / spacing).
 * Intercessors is the Vault's Intercessor room (by id), open to the Intercessors team.
 */

export type PrayerGatheringKey = 'morning-glory' | 'lunch-hour' | 'midnight-watch' | 'upper-room' | 'intercessors';

export type PrayerGathering = {
  key: PrayerGatheringKey;
  name: string;
  blurb: string;
  /** Other room names that count as this gathering. */
  aliases: string[];
};

export const PRAYER_GATHERINGS: PrayerGathering[] = [
  { key: 'morning-glory', name: 'Morning Glory', blurb: 'Start the day in prayer together.', aliases: [] },
  { key: 'lunch-hour', name: 'Lunch Hour', blurb: 'A midday pause to pray.', aliases: ['lunch hour prayer', 'lunchtime prayer'] },
  { key: 'midnight-watch', name: 'Midnight Watch', blurb: 'Watching and praying through the night.', aliases: ['midnight prayer'] },
  { key: 'upper-room', name: 'Upper Room', blurb: 'Waiting on the Lord together.', aliases: ['the upper room'] },
  { key: 'intercessors', name: 'Intercessors', blurb: 'Standing in the gap for the church.', aliases: ['intercessor channel', 'intercessors room'] },
];

export function normalizeRoomName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type RoomLike = { id: string; name: string };

/**
 * Match each gathering to a room. The Intercessors room comes from the Vault by id
 * (when this member may open it); the others match by name.
 */
export function matchPrayerGatherings<T extends RoomLike>(
  rooms: T[],
  intercessorsRoomId: string | null
): Record<PrayerGatheringKey, T | null> {
  const byName = new Map<string, T>();
  for (const r of rooms) {
    const n = normalizeRoomName(r.name);
    if (n && !byName.has(n)) byName.set(n, r);
  }
  const out = {} as Record<PrayerGatheringKey, T | null>;
  for (const g of PRAYER_GATHERINGS) {
    if (g.key === 'intercessors' && intercessorsRoomId) {
      out[g.key] = rooms.find((r) => r.id === intercessorsRoomId) ?? null;
      if (out[g.key]) continue;
    }
    const names = [g.name, ...g.aliases].map(normalizeRoomName);
    out[g.key] = names.map((n) => byName.get(n)).find(Boolean) ?? null;
  }
  return out;
}

/** Room ids used by Prayer Gathering — kept off the Ministries tab. */
export function prayerGatheringRoomIds(
  matched: Record<PrayerGatheringKey, RoomLike | null>
): Set<string> {
  return new Set(Object.values(matched).filter(Boolean).map((r) => (r as RoomLike).id));
}
