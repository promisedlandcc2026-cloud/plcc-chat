/**
 * Recent direct messages opened on this device — a fallback only. The real list
 * comes from the Vault (dm-list). Stored per account, so signing in with a
 * different account on the same browser never shows someone else's DMs.
 */

import type { ChatDirectoryMember } from './communityChatTypes';

const LEGACY_KEY = 'awc.chat.dmRecents.v1';
const keyFor = (ownerId: string) => `awc.chat.dmRecents.v2.${ownerId}`;

// The old shared list didn't know whose DMs they were — drop it.
try {
  localStorage.removeItem(LEGACY_KEY);
} catch {
  /* private mode */
}
const MAX_RECENTS = 30;

export type DmRecent = {
  channelId: string;
  partnerId: string;
  partnerName: string;
  avatarUrl: string | null;
  updatedAt: number;
};

function readAll(ownerId: string): DmRecent[] {
  if (!ownerId) return [];
  try {
    const raw = localStorage.getItem(keyFor(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is DmRecent =>
          Boolean(
            row &&
              typeof row === 'object' &&
              typeof (row as DmRecent).channelId === 'string' &&
              typeof (row as DmRecent).partnerId === 'string' &&
              typeof (row as DmRecent).partnerName === 'string'
          )
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeAll(ownerId: string, rows: DmRecent[]): void {
  if (!ownerId) return;
  try {
    localStorage.setItem(keyFor(ownerId), JSON.stringify(rows.slice(0, MAX_RECENTS)));
  } catch {
    /* ignore quota */
  }
}

export function listDmRecents(ownerId: string): DmRecent[] {
  return readAll(ownerId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function rememberDmRecent(input: {
  ownerId: string;
  channelId: string;
  partner: ChatDirectoryMember;
}): void {
  const next: DmRecent = {
    channelId: input.channelId,
    partnerId: input.partner.id,
    partnerName: input.partner.name,
    avatarUrl: input.partner.avatarUrl,
    updatedAt: Date.now(),
  };
  const rest = readAll(input.ownerId).filter((r) => r.channelId !== next.channelId);
  writeAll(input.ownerId, [next, ...rest]);
}

/** Keep this device's copy in step with the Vault's list (names, order). */
export function replaceDmRecents(ownerId: string, rows: DmRecent[]): void {
  writeAll(ownerId, rows);
}

export function dmDisplayName(channelId: string, fallback = 'Direct message', ownerId = ''): string {
  const hit = readAll(ownerId).find((r) => r.channelId === channelId);
  return hit?.partnerName || fallback;
}
