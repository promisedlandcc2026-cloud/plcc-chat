/**
 * Emergency entry into the prayer rooms (Nov 27, 2026 outage).
 * While Canaan is healthy, Ka Link quietly collects a 24-hour pass for every prayer
 * room (at most every 6 hours) and remembers the room list. If Canaan's database goes
 * down, the chat list shows these rooms with Join buttons, and joining uses the saved
 * pass (huddleFailsafe → voice-token-fallback), which needs no database.
 */
import { fetchKaLinkPasses } from './communityChatClient';
import { saveHuddleFallbackPass } from './huddleFailsafe';
import { savePrayerRooms } from './outageCache';

const REFRESH_KEY = 'plcc-ka-link-passes-at-v1';
export const PASS_REFRESH_MS = 6 * 60 * 60 * 1000;

export function passesDue(lastAt: number, now: number, userChanged: boolean): boolean {
  return userChanged || !lastAt || now - lastAt >= PASS_REFRESH_MS;
}

let inFlight: Promise<void> | null = null;

export function refreshEmergencyPasses(userId: string, now = Date.now()): Promise<void> {
  if (!userId) return Promise.resolve();
  let last: { userId?: string; at?: number } = {};
  try {
    last = JSON.parse(localStorage.getItem(REFRESH_KEY) || '{}');
  } catch {
    last = {};
  }
  if (!passesDue(Number(last.at || 0), now, last.userId !== userId)) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = fetchKaLinkPasses()
    .then((passes) => {
      for (const p of passes) saveHuddleFallbackPass(p.channelId, p.pass);
      if (passes.length) savePrayerRooms(userId, passes.map((p) => ({ channelId: p.channelId, name: p.name })));
      try {
        localStorage.setItem(REFRESH_KEY, JSON.stringify({ userId, at: now }));
      } catch {
        /* best-effort */
      }
    })
    .catch(() => undefined) // never bother the member about this
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
