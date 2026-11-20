/**
 * Turns the flat Issues log into what the owner actually wants to know:
 *   - Huddles: each call, who was on it, how long, and how each person's time ended
 *     (left on their own, kicked out, removed, closed the app, lost signal…).
 *   - People: per member across the range — huddles, time, drops, devices.
 * Pure functions (no React) so they can be tested.
 */
import type { IssueExtra, IssueRow } from './issueReport';

/** A quiet gap this long between events in a room starts a new huddle. */
export const SESSION_GAP_MS = 90 * 60_000;

export type Outcome =
  | 'still_on'
  | 'left'
  | 'ended_for_all'
  | 'kicked_out'
  | 'lost_signal'
  | 'removed'
  | 'other_device'
  | 'app_closed'
  | 'never_connected'
  | 'unknown';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  still_on: 'Still on the call',
  left: 'Left on their own',
  ended_for_all: 'Stayed until the huddle ended',
  kicked_out: "Kicked out — couldn't get back in",
  lost_signal: 'Lost connection — phone stopped answering',
  removed: 'Removed by a moderator',
  other_device: 'Switched to another phone or tab',
  app_closed: 'Closed the app (or the phone shut it)',
  never_connected: "Couldn't connect",
  unknown: 'No ending recorded',
};

/** red = something went wrong for the member, amber = worth a look, green/gray = normal. */
export const OUTCOME_TONE: Record<Outcome, 'bad' | 'warn' | 'ok' | 'neutral'> = {
  still_on: 'ok',
  left: 'ok',
  ended_for_all: 'ok',
  kicked_out: 'bad',
  lost_signal: 'bad',
  removed: 'warn',
  other_device: 'warn',
  app_closed: 'warn',
  never_connected: 'bad',
  unknown: 'neutral',
};

const BAD_SERVER_REASONS = new Set([
  'CONNECTION_TIMEOUT',
  'SIGNAL_CLOSE',
  'MEDIA_FAILURE',
  'STATE_MISMATCH',
  'JOIN_FAILURE',
  'SERVER_SHUTDOWN',
  'USER_UNAVAILABLE',
  'UNKNOWN_REASON',
]);

export function personKey(r: Pick<IssueRow, 'who' | 'userName'>): string {
  return r.who ? `u:${r.who}` : `n:${(r.userName || 'Someone').toLowerCase()}`;
}

export function isHuddleRow(r: IssueRow): boolean {
  return r.area === 'huddle' || r.code.startsWith('lk_') || /huddle/i.test(r.code);
}

export function isServerRow(r: IssueRow): boolean {
  return r.source === 'livekit';
}

export type PersonInSession = {
  key: string;
  name: string;
  devices: string[];
  firstSeen: string;
  lastSeen: string;
  /** Seconds on the call (best estimate). */
  seconds: number;
  joins: number;
  drops: number;
  autoRejoins: number;
  /** Times a phone call (or another app) paused their audio. */
  interruptions: number;
  /** Of those, how many came back by themselves. */
  interruptionsRecovered: number;
  outcome: Outcome;
  outcomeDetail: string | null;
  keepAwake: boolean;
  lowBattery: number | null;
  networks: string[];
  events: IssueRow[];
};

export type HuddleSession = {
  id: string;
  channelId: string | null;
  channelName: string;
  startedAt: string;
  endedAt: string;
  startedBy: string | null;
  endedForAll: boolean;
  open: boolean;
  people: PersonInSession[];
  events: IssueRow[];
  kickedOut: number;
  drops: number;
};

const ms = (iso: string) => new Date(iso).getTime();

function lastOf<T>(arr: T[], pred: (t: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i -= 1) if (pred(arr[i])) return arr[i];
  return undefined;
}

/** How did this person's time on the call end? Uses their last meaningful event. */
export function outcomeFor(events: IssueRow[], sessionOpen: boolean): { outcome: Outcome; detail: string | null } {
  const meaningful = events.filter(
    (e) =>
      ![
        'huddle_keep_awake',
        'huddle_reconnecting',
        'huddle_reconnected',
        'huddle_auto_rejoin',
        'huddle_interrupted',
        'huddle_audio_resumed',
      ].includes(e.code)
  );
  const last = meaningful[meaningful.length - 1];
  if (!last) return { outcome: 'unknown', detail: null };
  const reason = last.extra?.reason || null;
  // Phone said it plainly.
  switch (last.code) {
    case 'huddle_left':
      return { outcome: 'left', detail: null };
    case 'huddle_disconnected':
      return { outcome: 'kicked_out', detail: last.message };
    case 'huddle_removed':
      return { outcome: 'removed', detail: null };
    case 'huddle_other_device':
      return { outcome: 'other_device', detail: null };
    case 'huddle_ended_for_all':
    case 'Live Huddle ended for everyone':
      return { outcome: 'ended_for_all', detail: null };
    case 'huddle_app_closed':
      return { outcome: 'app_closed', detail: null };
    default:
      break;
  }
  if (last.code === 'lk_left') {
    // The server saw them go; check what the phone said just before.
    const phoneBefore = lastOf(meaningful.slice(0, -1), (e) => !isServerRow(e));
    if (phoneBefore?.code === 'huddle_left') return { outcome: 'left', detail: null };
    if (phoneBefore?.code === 'huddle_app_closed') return { outcome: 'app_closed', detail: null };
    const r = String(reason || '').toUpperCase();
    if (r === 'PARTICIPANT_REMOVED') return { outcome: 'removed', detail: null };
    if (r === 'DUPLICATE_IDENTITY') return { outcome: 'other_device', detail: null };
    if (r === 'ROOM_DELETED' || r === 'ROOM_CLOSED') return { outcome: 'ended_for_all', detail: null };
    if (r === 'CLIENT_INITIATED') return { outcome: 'left', detail: 'The app hung up (no Leave tap was reported)' };
    if (BAD_SERVER_REASONS.has(r) || !r) return { outcome: 'lost_signal', detail: last.title };
    return { outcome: 'unknown', detail: last.title };
  }
  if (last.code === 'huddle_dropped') return { outcome: 'kicked_out', detail: 'Dropped and no rejoin was recorded' };
  if (last.kind === 'problem') {
    const wasOn = meaningful.some((e) => e.code === 'huddle_joined' || e.code === 'lk_joined');
    if (!wasOn) return { outcome: 'never_connected', detail: last.title };
    return { outcome: sessionOpen ? 'still_on' : 'unknown', detail: last.title };
  }
  if (last.code === 'huddle_joined' || last.code === 'lk_joined') {
    return { outcome: sessionOpen ? 'still_on' : 'unknown', detail: null };
  }
  return { outcome: sessionOpen ? 'still_on' : 'unknown', detail: null };
}

/** Seconds on the call: server join/leave pairs when we have them, else the phone's own timer. */
export function secondsOnCall(events: IssueRow[], sessionEnd: number, now: number, open: boolean): number {
  let total = 0;
  let openSince: number | null = null;
  let sawServer = false;
  for (const e of events) {
    if (e.code === 'lk_joined') {
      sawServer = true;
      if (openSince == null) openSince = ms(e.at);
    } else if (e.code === 'lk_left') {
      sawServer = true;
      if (openSince != null) {
        total += Math.max(0, ms(e.at) - openSince);
        openSince = null;
      } else if (typeof e.extra?.durationSec === 'number') {
        total += e.extra.durationSec * 1000;
      }
    }
  }
  if (openSince != null) total += Math.max(0, (open ? now : sessionEnd) - openSince);
  if (sawServer) return Math.round(total / 1000);
  let best = 0;
  for (const e of events) if (typeof e.extra?.durationSec === 'number') best = Math.max(best, e.extra.durationSec);
  return best;
}

function summarizePerson(key: string, events: IssueRow[], sessionEnd: number, open: boolean, now: number): PersonInSession {
  const devices: string[] = [];
  const networks: string[] = [];
  let keepAwake = false;
  let lowBattery: number | null = null;
  for (const e of events) {
    if (e.device && !devices.includes(e.device)) devices.push(e.device);
    const x: IssueExtra = e.extra || {};
    if (x.net && !networks.includes(x.net)) networks.push(x.net);
    if (x.keepAwake) keepAwake = true;
    if (typeof x.battery === 'number' && !x.charging && x.battery <= 15) {
      lowBattery = lowBattery == null ? x.battery : Math.min(lowBattery, x.battery);
    }
  }
  const named = events.find((e) => e.userName)?.userName || 'Someone';
  const serverJoins = events.filter((e) => e.code === 'lk_joined').length;
  const phoneJoins = events.filter((e) => e.code === 'huddle_joined').length;
  const { outcome, detail } = outcomeFor(events, open);
  return {
    key,
    name: named,
    devices,
    firstSeen: events[0].at,
    lastSeen: events[events.length - 1].at,
    seconds: secondsOnCall(events, sessionEnd, now, open),
    joins: Math.max(serverJoins, phoneJoins),
    drops:
      // Signal-only wobbles (audio kept going) aren't drops.
      events.filter(
        (e) => e.code === 'huddle_dropped' || (e.code === 'huddle_reconnecting' && e.extra?.reason !== 'signal')
      ).length +
      events.filter((e) => e.code === 'lk_left' && BAD_SERVER_REASONS.has(String(e.extra?.reason || '').toUpperCase()))
        .length,
    autoRejoins: events.filter((e) => e.code === 'huddle_auto_rejoin').length,
    interruptions: events.filter((e) => e.code === 'huddle_interrupted').length,
    interruptionsRecovered: events.filter((e) => e.code === 'huddle_audio_resumed').length,
    outcome,
    outcomeDetail: detail,
    keepAwake,
    lowBattery,
    networks,
    events,
  };
}

const TROUBLE_ORDER: Outcome[] = [
  'kicked_out',
  'lost_signal',
  'never_connected',
  'app_closed',
  'removed',
  'other_device',
  'unknown',
  'still_on',
  'left',
  'ended_for_all',
];

/** Group huddle rows (any order) into calls, newest first. */
export function buildSessions(rows: IssueRow[], now = Date.now()): HuddleSession[] {
  const byRoom = new Map<string, IssueRow[]>();
  for (const r of rows) {
    if (!isHuddleRow(r) || !r.channelId) continue;
    const list = byRoom.get(r.channelId) || [];
    list.push(r);
    byRoom.set(r.channelId, list);
  }
  const sessions: HuddleSession[] = [];
  for (const [channelId, list] of byRoom) {
    list.sort((a, b) => ms(a.at) - ms(b.at));
    let cur: IssueRow[] = [];
    const flush = () => {
      if (!cur.length) return;
      sessions.push(toSession(channelId, cur, now));
      cur = [];
    };
    for (const r of list) {
      const prev = cur[cur.length - 1];
      if (prev && ms(r.at) - ms(prev.at) > SESSION_GAP_MS) flush();
      cur.push(r);
      if (r.code === 'Live Huddle ended for everyone') flush();
    }
    flush();
  }
  return sessions.sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
}

function toSession(channelId: string, events: IssueRow[], now: number): HuddleSession {
  const startedAt = events[0].at;
  const endedAt = events[events.length - 1].at;
  const endedForAll = events.some((e) => e.code === 'Live Huddle ended for everyone' || e.code === 'huddle_ended_for_all');
  const open = !endedForAll && now - ms(endedAt) < SESSION_GAP_MS;
  const byPerson = new Map<string, IssueRow[]>();
  for (const e of events) {
    // Room-level audit rows ("started", "ended for everyone") still belong to whoever did it.
    const k = personKey(e);
    const list = byPerson.get(k) || [];
    list.push(e);
    byPerson.set(k, list);
  }
  const people = [...byPerson.entries()]
    .map(([k, evs]) => summarizePerson(k, evs, ms(endedAt), open, now))
    .sort(
      (a, b) =>
        TROUBLE_ORDER.indexOf(a.outcome) - TROUBLE_ORDER.indexOf(b.outcome) ||
        b.drops - a.drops ||
        ms(a.firstSeen) - ms(b.firstSeen)
    );
  const starter = events.find((e) => e.code === 'Live Huddle started');
  return {
    id: `${channelId}:${startedAt}`,
    channelId,
    channelName: events.find((e) => e.channelName)?.channelName || 'Room',
    startedAt,
    endedAt,
    startedBy: starter?.userName || null,
    endedForAll,
    open,
    people,
    events,
    kickedOut: people.filter((p) => OUTCOME_TONE[p.outcome] === 'bad').length,
    drops: people.reduce((n, p) => n + p.drops, 0),
  };
}

export type PersonSummary = {
  key: string;
  name: string;
  huddles: number;
  seconds: number;
  troubles: number;
  drops: number;
  devices: string[];
  lastSeen: string;
  lastOutcome: Outcome;
  lastRoom: string;
  problems: number;
};

/** One line per member across all calls (and any non-huddle problems they hit). */
export function buildPeople(sessions: HuddleSession[], rows: IssueRow[]): PersonSummary[] {
  const map = new Map<string, PersonSummary>();
  const sorted = [...sessions].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  for (const s of sorted) {
    for (const p of s.people) {
      const cur =
        map.get(p.key) ||
        ({
          key: p.key,
          name: p.name,
          huddles: 0,
          seconds: 0,
          troubles: 0,
          drops: 0,
          devices: [],
          lastSeen: p.lastSeen,
          lastOutcome: p.outcome,
          lastRoom: s.channelName,
          problems: 0,
        } as PersonSummary);
      cur.huddles += 1;
      cur.seconds += p.seconds;
      cur.drops += p.drops;
      if (OUTCOME_TONE[p.outcome] === 'bad') cur.troubles += 1;
      p.devices.forEach((d) => !cur.devices.includes(d) && cur.devices.push(d));
      if (ms(p.lastSeen) >= ms(cur.lastSeen)) {
        cur.lastSeen = p.lastSeen;
        cur.lastOutcome = p.outcome;
        cur.lastRoom = s.channelName;
      }
      if (p.name !== 'Someone') cur.name = p.name;
      map.set(p.key, cur);
    }
  }
  for (const r of rows) {
    if (r.kind !== 'problem') continue;
    const k = personKey(r);
    const cur = map.get(k);
    if (cur) cur.problems += 1;
    else {
      map.set(k, {
        key: k,
        name: r.userName || 'Someone',
        huddles: 0,
        seconds: 0,
        troubles: 0,
        drops: 0,
        devices: r.device ? [r.device] : [],
        lastSeen: r.at,
        lastOutcome: 'unknown',
        lastRoom: r.channelName || '',
        problems: 1,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.troubles - a.troubles || b.problems - a.problems || ms(b.lastSeen) - ms(a.lastSeen)
  );
}

export function formatDuration(sec: number): string {
  if (!sec || sec < 60) return sec ? `${sec}s` : '—';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

/** Short "on what" line: network, battery, keep-awake, screen state. */
export function contextLine(x: IssueExtra | null | undefined): string | null {
  if (!x) return null;
  const bits: string[] = [];
  if (x.line === 'daily') bits.push('backup line');
  if (x.net) bits.push(x.net === 'offline' ? 'offline' : x.net === 'wifi' ? 'Wi-Fi' : x.net.toUpperCase());
  if (typeof x.battery === 'number') bits.push(`battery ${x.battery}%${x.charging ? ' (charging)' : ''}`);
  if (x.keepAwake) bits.push('screen kept on');
  if (x.hidden === true) bits.push('app was in the background');
  if (x.reason && !/^daily_/.test(x.reason)) bits.push(`reason: ${x.reason.toLowerCase().replace(/_/g, ' ')}`);
  if (typeof x.attempt === 'number' && x.attempt > 0) bits.push(`try #${x.attempt}`);
  return bits.length ? bits.join(' · ') : null;
}
