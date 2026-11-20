/**
 * Issues page → People → "What happened and why".
 *
 * Reads one member's log and explains it in plain English, with dates, rooms and
 * times as proof, and says honestly what caused each problem:
 *   phone       — the phone or how it was used (screen locked, app closed, open twice…)
 *   connection  — Wi-Fi or mobile data dropped with the screen on
 *   app         — something in Ka Link / Tribes / Canaan broke (crash, errors, setup) — on us
 *   info        — harmless, for context
 * Each point says what fixes it. Pure functions (no React) so they can be tested.
 */
import type { IssueRow } from './issueReport';
import { OUTCOME_TONE, personKey, type HuddleSession } from './issuesInsights';

export type Cause = 'phone' | 'connection' | 'app' | 'info';

export type Finding = {
  cause: Cause;
  /** One plain sentence (or two) with the proof: dates, times, rooms. */
  text: string;
  /** What fixes it: what the member should do, or what the app already does. */
  fix: string | null;
};

export type Diagnosis = {
  verdict: 'phone' | 'connection' | 'app' | 'mixed' | 'fine';
  /** Bottom line in one sentence. */
  summary: string;
  findings: Finding[];
  /** Ready to paste into WhatsApp for the member. */
  whatsapp: string;
};

const TZ = 'America/New_York';
/** Nov 19, 2026 ~6:40 PM ET: rejoining after the background no longer gets stuck (Ka Link + Tribes). */
export const STALLED_REJOIN_FIX_AT = Date.parse('2026-11-19T23:40:00Z');

const LOST = new Set(['CONNECTION_TIMEOUT', 'SIGNAL_CLOSE', 'MEDIA_FAILURE', 'STATE_MISMATCH', 'UNKNOWN_REASON']);
const ms = (iso: string) => new Date(iso).getTime();
const isServer = (r: IssueRow) => r.code.startsWith('lk_') || r.source === 'livekit';

export function when(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}
export function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
}
export function howLong(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (r < 8) return h === 1 ? 'over an hour' : `over ${h} hours`;
  if (r >= 23 && r <= 37) return `${h === 1 ? '1' : h}.5 hours`;
  return `${h} h ${r} min`;
}
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const room = (r: IssueRow) => r.channelName || 'a call';

function phoneKind(devices: string[]): { label: string; iOS: boolean } {
  const all = devices.join(' ');
  if (/iPhone|iPad/.test(all)) return { label: /iPad/.test(all) && !/iPhone/.test(all) ? 'iPad' : 'iPhone', iOS: true };
  if (/Android/.test(all)) return { label: 'Android phone', iOS: false };
  return { label: 'phone', iOS: false };
}

/** Split a person's rows into incidents: events closer than gapMs belong together. */
function incidents(rows: IssueRow[], gapMs: number): IssueRow[][] {
  const out: IssueRow[][] = [];
  for (const r of rows) {
    const cur = out[out.length - 1];
    if (cur && ms(r.at) - ms(cur[cur.length - 1].at) <= gapMs) cur.push(r);
    else out.push([r]);
  }
  return out;
}

export function diagnosePerson(
  key: string,
  allRows: IssueRow[],
  sessions: HuddleSession[],
  opts: { now?: number } = {}
): Diagnosis {
  const now = opts.now ?? Date.now();
  const rows = allRows.filter((r) => personKey(r) === key).sort((a, b) => ms(a.at) - ms(b.at));
  const name = rows.find((r) => r.userName)?.userName || 'This member';
  // Greeting name: "Sophia", but keep titles whole ("Mrs Bogere", "Pastor John").
  const parts = name.split(/\s+/);
  const first = /^(mr|mrs|ms|miss|dr|pastor|pr|bro|sis|sister|brother|elder|deacon|apostle|rev)\.?$/i.test(parts[0]) ? name : parts[0];
  const devices = [...new Set(rows.map((r) => r.device).filter(Boolean) as string[])];
  const phone = phoneKind(devices);
  const browserApp = phone.iOS ? 'Safari' : 'the browser';
  const findings: Finding[] = [];
  const tips: string[] = [];

  // ---- Which app they use -------------------------------------------------------
  const installed = devices.some((d) => /installed app/.test(d));
  const inBrowser = devices.some((d) => !/installed app/.test(d));
  if (devices.length) {
    if (inBrowser && !installed) {
      findings.push({
        cause: 'phone',
        text: `Uses Ka Link in ${browserApp} on ${phone.label === 'phone' ? 'a phone' : `an ${phone.label}`}, not the installed home-screen app.`,
        fix: phone.iOS
          ? 'Install it: open Ka Link in Safari → Share → Add to Home Screen, then always open it from that icon.'
          : 'Install it from the browser menu (Add to Home screen / Install app) and open it from that icon.',
      });
      tips.push(
        phone.iOS
          ? '*Put Ka Link on your home screen.* Open plcc-chat.vercel.app in Safari, tap Share (square with an arrow), then *Add to Home Screen*. Always open Ka Link from that icon.'
          : '*Install Ka Link.* Open plcc-chat.vercel.app, tap the menu (⋮) and choose *Add to Home screen* or *Install app*. Always open it from that icon.'
      );
    } else if (installed && inBrowser) {
      findings.push({
        cause: 'info',
        text: `Uses Ka Link both in ${browserApp} and in the installed home-screen app.`,
        fix: 'Use only the installed app, so it is never open in two places at once.',
      });
    }
  }

  // ---- Screen kept on: proof the call holds while the app stays open ------------
  const mine = sessions
    .map((s) => ({ s, p: s.people.find((p) => p.key === key) }))
    .filter((x) => x.p) as Array<{ s: HuddleSession; p: HuddleSession['people'][number] }>;
  const goodAwake = mine
    .filter(({ p }) => p.seconds >= 20 * 60 && OUTCOME_TONE[p.outcome] !== 'bad' && p.drops === 0)
    .sort((a, b) => b.p.seconds - a.p.seconds)
    .slice(0, 2);
  if (goodAwake.length) {
    const proof = goodAwake
      .map(({ s, p }) => `on ${dayOf(p.firstSeen)} ${name} was on ${s.channelName} for ${howLong(p.seconds)} with no drop`)
      .join('; ');
    findings.push({
      cause: 'info',
      text: `With the app open on screen, stays connected: ${proof}.`,
      fix: null,
    });
  }

  // ---- Drops: screen locked (phone) vs screen on (connection) --------------------
  const otherDevice = rows.filter((r) => r.code === 'huddle_other_device' || (isServer(r) && r.code === 'lk_left' && String(r.extra?.reason).toUpperCase() === 'DUPLICATE_IDENTITY'));
  const nearOtherDevice = (t: number) => otherDevice.some((o) => Math.abs(ms(o.at) - t) < 60_000);
  const lockDrops: Array<{ at: IssueRow; afterSec: number }> = [];
  const screenOnDrops: IssueRow[] = [];
  rows.forEach((r, i) => {
    const serverLost = isServer(r) && r.code === 'lk_left' && LOST.has(String(r.extra?.reason || '').toUpperCase());
    const phoneGaveUp = r.code === 'huddle_disconnected';
    if (!serverLost && !phoneGaveUp) return;
    const t = ms(r.at);
    if (nearOtherDevice(t)) return; // part of an "open twice" incident, explained below
    // Don't count the same drop twice (phone + server both report it).
    const last = lockDrops[lockDrops.length - 1]?.at || screenOnDrops[screenOnDrops.length - 1];
    if (last && t - ms(last.at) < 3 * 60_000) return;
    // What did the phone say just before? (within 3 minutes)
    let before: IssueRow | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (t - ms(rows[j].at) > 3 * 60_000) break;
      if (!isServer(rows[j]) && rows[j].extra) {
        before = rows[j];
        break;
      }
    }
    if (before?.extra?.hidden === true && before.extra.keepAwake !== true) {
      lockDrops.push({ at: r, afterSec: Math.max(1, Math.round((t - ms(before.at)) / 1000)) });
    } else {
      screenOnDrops.push(r);
    }
  });
  if (lockDrops.length) {
    const lastDrop = lockDrops[lockDrops.length - 1];
    const typical = Math.round(lockDrops.reduce((n, d) => n + d.afterSec, 0) / lockDrops.length);
    const freezes = phone.iOS ? `iOS freezes ${installed && !inBrowser ? 'the app' : browserApp}` : 'the phone pauses the app';
    findings.push({
      cause: 'phone',
      text:
        `They pressed the power button or switched to another app during the call, and ${freezes}. ` +
        `About ${typical} seconds later the call drops. On ${when(lastDrop.at.at)} ${name} was dropped from ${room(lastDrop.at)} exactly this way` +
        (lockDrops.length > 1 ? ` (${times(lockDrops.length)} in this period).` : '.'),
      fix:
        'Ka Link already keeps the screen on during calls. Keep the app open on screen, don\'t press the power button, plug in for long calls, and turn off Battery Saver / Low Power Mode (it can let the screen sleep).',
    });
    tips.push(
      `*Keep Ka Link open on your screen during calls.* Don't press the power button or switch apps — your phone pauses the call. Plug in your phone for long prayers, and turn off Battery Saver / Low Power Mode.`
    );
  }
  if (screenOnDrops.length) {
    const d = screenOnDrops[screenOnDrops.length - 1];
    findings.push({
      cause: 'connection',
      text: `Dropped ${times(screenOnDrops.length)} with the screen on, which usually means the Wi-Fi or mobile data cut out. Last time: ${when(d.at)} in ${room(d)}.`,
      fix: 'Move closer to the Wi-Fi router or switch between Wi-Fi and mobile data. If it keeps happening on a strong signal, look into it as an app problem.',
    });
    tips.push('*Check your signal.* If calls drop with the screen on, move closer to the Wi-Fi or switch between Wi-Fi and mobile data.');
  }

  // ---- Closing the app mid-call ------------------------------------------------
  const closed = rows.filter((r) => r.code === 'huddle_app_closed');
  if (closed.length) {
    findings.push({
      cause: 'phone',
      text: `Closes and reopens ${inBrowser && !installed ? browserApp : 'the app'} during calls (${times(closed.length)} in this period), and each time has to rejoin.`,
      fix: 'Leave the app open during a call. To check something quickly, come straight back.',
    });
    tips.push('*Please don\'t close Ka Link during a call.* Every time it closes, the call ends and you have to join again.');
  }

  // ---- Open in two places ----------------------------------------------------------
  const twoPlaces = incidents(rows.filter((r) => r.code === 'huddle_other_device'), 10 * 60_000);
  if (twoPlaces.length) {
    const inc = twoPlaces[0];
    const incDevices = new Set(
      rows
        .filter((r) => r.device && Math.abs(ms(r.at) - ms(inc[0].at)) < 15 * 60_000)
        .map((r) => /installed app/.test(r.device || ''))
    );
    const how = incDevices.size > 1 ? `in ${browserApp} and in the installed app at the same time` : 'in two tabs or on two phones at the same time';
    findings.push({
      cause: 'phone',
      text:
        `On ${dayOf(inc[0].at)} had Ka Link open twice, ${how}, so the two kept kicking each other out` +
        (twoPlaces.length > 1 ? ` (${times(twoPlaces.length)} in this period).` : '.'),
      fix: 'Use Ka Link in one place only — the installed app, not the browser as well (and not Tribes in the same call).',
    });
    if (installed && inBrowser) tips.push('*Use only the Ka Link app on your home screen*, not Safari or Chrome as well. Having it open in both places makes them kick each other off.');
  }

  // ---- Small audio blips -----------------------------------------------------------
  const paused = rows.filter((r) => r.code === 'huddle_interrupted' && /sound_paused|audio_suspended/.test(String(r.extra?.reason)));
  const micTaken = rows.filter((r) => r.code === 'huddle_interrupted' && r.extra?.reason === 'mic_taken');
  if (paused.length) {
    findings.push({
      cause: 'info',
      text: `Small audio blips ("sound paused", ${times(paused.length)}) come from the ${phone.label} pausing sound for notifications or other audio. They come back on their own within a few seconds.`,
      fix: null,
    });
  }
  if (micTaken.length) {
    findings.push({
      cause: 'info',
      text: `A phone call or another app took the microphone ${times(micTaken.length)}. The app brought the audio back afterwards.`,
      fix: null,
    });
  }

  // ---- Real app problems (on us) ---------------------------------------------------
  const crashes = rows.filter((r) => r.code === 'app_crash');
  for (const c of crashes.slice(-3)) {
    const app = c.source === 'tribes-app' ? 'PLCC Tribes' : c.source === 'canaan' ? 'PLCC Canaan' : 'PLCC Ka Link';
    findings.push({
      cause: 'app',
      text: `${app} crashed on their ${phone.label} on ${when(c.at)}${c.message ? ` ("${c.message.slice(0, 80)}")` : ''}. This is a bug in ${app}, not the phone.`,
      fix: 'Needs fixing in the app. A screenshot from the member helps if it happens again.',
    });
  }
  // ---- Rejoin stuck after coming back (fixed Nov 19) ------------------------------
  const stalled = rows.filter((r) => r.code === 'huddle_join_stalled');
  if (stalled.length) {
    const last = stalled[stalled.length - 1];
    findings.push({
      cause: 'app',
      text: `Coming back to the app, rejoining got stuck ${times(stalled.length)} (last: ${when(last.at)}${last.channelName ? `, ${last.channelName}` : ''}). This was an app problem, not the phone.`,
      fix:
        ms(last.at) < STALLED_REJOIN_FIX_AT
          ? 'Fixed Nov 19: the app now gives up after 35 seconds, tries again, then offers Reload.'
          : 'The app gave up and retried as designed. If they still saw Reload, tapping it gets them back in.',
    });
  }

  // ---- Sign-in problems (Canaan's log, with its advice) ---------------------------
  const signin = new Map<string, IssueRow[]>();
  rows.filter((r) => r.code.startsWith('signin_')).forEach((r) => signin.set(r.code, [...(signin.get(r.code) || []), r]));
  for (const [code, list] of signin) {
    const last = list[list.length - 1];
    const reason = code.slice('signin_'.length);
    const cause: Cause = reason === 'server_unreachable'
      ? 'connection'
      : ['member_pending', 'member_not_found', 'member_check_failed', 'server_error', 'signup_failed'].includes(reason)
        ? 'app'
        : 'phone';
    findings.push({
      cause,
      text: `${last.title} — ${times(list.length)} (last: ${when(last.at)}${last.message ? `, "${last.message.slice(0, 60)}"` : ''}).`,
      fix: last.fix || null,
    });
  }

  const benign = (r: IssueRow) =>
    r.code.startsWith('signin_') ||
    r.code === 'huddle_join_stalled' ||
    r.code === 'app_crash' ||
    r.code === 'huddle_disconnected' ||
    r.code === 'huddle_other_device' ||
    (r.status === 403 && /attendance|recording|minutes/.test(`${r.path} ${r.message}`));
  const otherProblems = new Map<string, IssueRow[]>();
  rows.filter((r) => r.kind === 'problem' && !benign(r)).forEach((r) => {
    const k = r.title || r.code;
    otherProblems.set(k, [...(otherProblems.get(k) || []), r]);
  });
  for (const [title, list] of otherProblems) {
    const last = list[list.length - 1];
    findings.push({
      cause: last.status === 429 ? 'info' : 'app',
      text: `"${title}" happened ${times(list.length)} (last: ${when(last.at)}${last.channelName ? `, ${last.channelName}` : ''}).`,
      fix: last.status === 429 ? 'They tapped Join too many times in a row. It clears by itself in a minute.' : 'Worth a look in the app.',
    });
  }

  // ---- Bottom line ----------------------------------------------------------------
  const n = (c: Cause) => findings.filter((f) => f.cause === c).length;
  const phoneN = lockDrops.length + closed.length + twoPlaces.length + findings.filter((f) => f.cause === 'phone' && /sign in/i.test(f.text)).length;
  const connN = screenOnDrops.length + (signin.has('signin_server_unreachable') ? 1 : 0);
  const appN = n('app');
  let verdict: Diagnosis['verdict'];
  let summary: string;
  if (!phoneN && !connN && !appN) {
    verdict = 'fine';
    summary = 'No drops or app problems recorded in this period.';
  } else if (appN && !phoneN && !connN) {
    verdict = 'app';
    summary = 'The problems here are in the app. That part is on us.';
  } else if (phoneN >= connN * 2 && !appN) {
    verdict = 'phone';
    summary = `Mostly the ${phone.label} and how it's used (leaving the app, closing it, opening it twice, typing the number wrong), not Ka Link.`;
  } else if (connN > phoneN && !appN) {
    verdict = 'connection';
    summary = 'Mostly the internet connection (Wi-Fi or mobile data) dropping with the screen on.';
  } else {
    verdict = 'mixed';
    summary =
      appN && phoneN
        ? `Mostly the ${phone.label} and how it's used, plus ${appN === 1 ? 'one app problem that is' : `${appN} app problems that are`} on us.`
        : 'A mix of phone settings and connection drops.';
  }

  const greeting = name === 'This member' ? 'Hi 🙏' : `Hi ${first} 🙏`;
  const whatsapp = tips.length
    ? [
        greeting,
        '',
        "I looked into why you've had trouble on Ka Link. It's an easy fix. Please do these:",
        '',
        ...tips.map((t, i) => `${i + 1}️⃣ ${t}`),
        '',
        "If it still happens after this, let me know and I'll look again. God bless 🙏",
      ].join('\n')
    : '';

  return { verdict, summary, findings, whatsapp };
}
