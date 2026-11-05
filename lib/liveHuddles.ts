/**
 * Home "Live Huddles" — pure helpers (no I/O).
 */
import {
  isHuddleChannelLive,
  type CommunityChatChannel,
  type HuddleChannelStatus,
} from './communityChatTypes';

export type LiveHuddleRow = { id: string; name: string; count: number };

/** Live channel huddles, busiest first. */
export function liveHuddleRows(
  channels: Array<Pick<CommunityChatChannel, 'id' | 'name'>>,
  status: Record<string, HuddleChannelStatus>
): LiveHuddleRow[] {
  return channels
    .filter((c) => isHuddleChannelLive(status[c.id]))
    .map((c) => ({ id: c.id, name: c.name, count: status[c.id]?.participantCount || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 4);
}

export type HuddleIntent = 'join' | 'start';

/** Chat room link that opens with a one-tap Join / Start card. */
export function huddleRoomPath(channelId: string, intent: HuddleIntent): string {
  return `/community/chat/${encodeURIComponent(channelId)}?huddle=${intent}`;
}

export function parseHuddleIntent(search: string): HuddleIntent | null {
  const v = new URLSearchParams(search).get('huddle');
  return v === 'join' || v === 'start' ? v : null;
}
