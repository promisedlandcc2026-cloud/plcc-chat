/**
 * Sends problems a member hits on their phone to the owner-only issue log
 * (Account → Issues in Ka Link and Tribes, kept on Canaan). Codes and room ids only —
 * never message text or tokens.
 * Best effort: never throws, never shows anything to the member.
 */
import { supabase } from './supabase';

export type IssueArea = 'huddle' | 'room' | 'messages' | 'signin' | 'media' | 'app' | 'other';

/** Structured huddle details (whitelisted again on the server). */
export type IssueExtra = {
  line?: 'livekit' | 'daily';
  durationSec?: number;
  outageSec?: number;
  reason?: string;
  attempt?: number;
  keepAwake?: boolean;
  hidden?: boolean;
  net?: string;
  battery?: number;
  charging?: boolean;
};

export type IssueReport = {
  area: IssueArea;
  code: string;
  status?: number | null;
  message?: string | null;
  channelId?: string | null;
  extra?: IssueExtra | null;
};

/**
 * Huddle activity (not problems) shown on the Issues page's Huddles / People
 * tabs. Keep in step with HUDDLE_ACTIVITY_CODES on the Vault.
 */
export type HuddleActivityCode =
  | 'huddle_joined'
  | 'huddle_left'
  | 'huddle_reconnecting'
  | 'huddle_reconnected'
  | 'huddle_dropped'
  | 'huddle_auto_rejoin'
  | 'huddle_removed'
  | 'huddle_ended_for_all'
  | 'huddle_other_device'
  | 'huddle_app_closed'
  | 'huddle_keep_awake'
  | 'huddle_interrupted'
  | 'huddle_audio_resumed'
  | 'huddle_voice_healed'
  | 'huddle_join_stalled';

const DEDUPE_MS = 60_000;
const ACTIVITY_DEDUPE_MS = 3_000;
const MAX_PER_SESSION = 25;
const MAX_ACTIVITY_PER_SESSION = 120;
const recent = new Map<string, number>();
let sent = 0;
let activitySent = 0;

type UADataNavigator = Navigator & {
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }>;
  };
  connection?: { effectiveType?: string; type?: string };
  getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener?: (t: string, f: () => void) => void }>;
};

/** Android phone model (Chrome only, and only when it tells us). */
let androidModel = '';
let battery: { level: number; charging: boolean } | null = null;

function primeDeviceDetails(): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as UADataNavigator;
  try {
    void nav.userAgentData
      ?.getHighEntropyValues?.(['model', 'platformVersion'])
      .then((v) => {
        androidModel = String(v?.model || '').slice(0, 40);
      })
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
  try {
    void nav
      .getBattery?.()
      .then((b) => {
        const sync = () => {
          battery = { level: b.level, charging: b.charging };
        };
        sync();
        b.addEventListener?.('levelchange', sync);
        b.addEventListener?.('chargingchange', sync);
      })
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** e.g. "iPhone · iOS 17.5 · Safari · installed app" or "Android 14 · SM-S918U · Chrome". */
export function deviceLabel(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): string {
  if (!nav) return '';
  const ua = nav.userAgent || '';
  const touchMac = /Macintosh/.test(ua) && ((nav as any).maxTouchPoints || 0) > 1;
  const iosVer = /OS (\d+)[_.](\d+)/.exec(ua);
  const androidVer = /Android (\d+(?:\.\d+)?)/.exec(ua);
  let os: string;
  if (/iPhone|iPod/.test(ua)) os = `iPhone${iosVer ? ` · iOS ${iosVer[1]}.${iosVer[2]}` : ''}`;
  else if (/iPad/.test(ua) || touchMac) os = `iPad${iosVer ? ` · iPadOS ${iosVer[1]}.${iosVer[2]}` : ''}`;
  else if (/Android/.test(ua)) {
    const uaModel = /Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/.exec(ua)?.[1] || '';
    const model = androidModel || (uaModel && uaModel !== 'K' ? uaModel : '');
    os = `Android${androidVer ? ` ${androidVer[1]}` : ''}${model ? ` · ${model.slice(0, 40)}` : ''}`;
  } else if (/Mac OS X/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'Chromebook';
  else os = 'Other';
  const browser = /SamsungBrowser/.test(ua)
    ? 'Samsung Internet'
    : /CriOS|Chrome\//.test(ua) && !/Edg/.test(ua)
      ? 'Chrome'
      : /FxiOS|Firefox\//.test(ua)
        ? 'Firefox'
        : /Edg/.test(ua)
          ? 'Edge'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const standalone =
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
    (nav as any).standalone === true;
  return `${os} · ${browser}${standalone ? ' · installed app' : ''}`;
}

/** Network + battery + whether the app was on screen, attached to every report. */
function contextExtra(): IssueExtra {
  const out: IssueExtra = {};
  if (typeof navigator !== 'undefined') {
    const c = (navigator as UADataNavigator).connection;
    const net = String(c?.type && c.type !== 'unknown' ? c.type : c?.effectiveType || '').toLowerCase();
    if (net) out.net = net.slice(0, 20);
    if (navigator.onLine === false) out.net = 'offline';
  }
  if (battery) {
    out.battery = Math.round(battery.level * 100);
    out.charging = battery.charging;
  }
  if (typeof document !== 'undefined') out.hidden = document.visibilityState !== 'visible';
  return out;
}

/** Last good sign-in token, so a report can still go out while the page is closing. */
let cachedToken: string | null = null;

async function bearer(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    cachedToken = data.session?.access_token || null;
    return cachedToken;
  } catch {
    return cachedToken;
  }
}

function post(token: string, body: unknown): void {
  void fetch('/api/community-chat?resource=issue-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}

function payload(report: IssueReport) {
  return {
    area: report.area,
    code: report.code,
    status: report.status ?? null,
    message: report.message ? String(report.message).slice(0, 300) : null,
    channelId: report.channelId || null,
    source: 'ka-link-app',
    path: typeof location !== 'undefined' ? location.pathname : null,
    device: deviceLabel(),
    extra: { ...contextExtra(), ...(report.extra || {}) },
  };
}

function admit(report: IssueReport, activity: boolean): boolean {
  const key = `${report.area}:${report.code}:${report.channelId || ''}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < (activity ? ACTIVITY_DEDUPE_MS : DEDUPE_MS)) return false;
  if (activity ? activitySent >= MAX_ACTIVITY_PER_SESSION : sent >= MAX_PER_SESSION) return false;
  recent.set(key, now);
  if (activity) activitySent += 1;
  else sent += 1;
  return true;
}

function send(report: IssueReport, activity: boolean, immediate: boolean): void {
  try {
    if (!admit(report, activity)) return;
    const body = payload(report);
    // While the page is closing there's no time to look up the session.
    if (immediate) {
      if (cachedToken) post(cachedToken, body);
      return;
    }
    void (async () => {
      const token = await bearer();
      if (token) post(token, body);
    })();
  } catch {
    /* never let reporting break the app */
  }
}

export function reportIssue(report: IssueReport): void {
  send(report, false, false);
}

/**
 * Huddle activity for the owner's Issues page (joined, left, dropped, removed…).
 * `immediate` sends with the cached token right away — use it from pagehide.
 */
export function reportHuddleActivity(
  code: HuddleActivityCode,
  channelId: string | null | undefined,
  extra?: IssueExtra | null,
  opts?: { immediate?: boolean; message?: string | null }
): void {
  send({ area: 'huddle', code, channelId: channelId || null, extra: extra || null, message: opts?.message ?? null }, true, Boolean(opts?.immediate));
}

/**
 * Run `report` when the page is closing (app swiped away, phone killed the tab).
 * Reporting only — this must never disconnect or change the call.
 */
export function onPageClosing(report: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => {
    try {
      report();
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('pagehide', handler);
  return () => window.removeEventListener('pagehide', handler);
}

/**
 * Where a crash happened, short enough for the Issues log (Vault keeps 300 characters):
 * the screen, then the first few code locations from the error's stack.
 * Example: "screen / · at loadFeed (index-abc.js:2:1234) < render (index-abc.js:9:88)".
 */
export function crashWhere(err?: any, filename?: string, lineno?: number): string {
  const screen = typeof location !== 'undefined' ? location.pathname || '/' : '';
  const stack = typeof err?.stack === 'string' ? err.stack : '';
  const frames = stack
    .split('\n')
    .map((l: string) => l.trim().replace(/^at\s+/, ''))
    .filter((l: string) => l && !/^(RangeError|TypeError|Error|ReferenceError)\b/.test(l))
    .map((l: string) => l.replace(/https?:\/\/[^/\s)]+\//g, '').replace(/\?[^:\s)]*/g, ''))
    // Safari repeats the same frame thousands of times on "Maximum call stack": keep distinct ones.
    .filter((l: string, i: number, all: string[]) => all.indexOf(l) === i)
    .slice(0, 4);
  const at = frames.length
    ? frames.join(' < ')
    : filename
      ? `${String(filename).replace(/https?:\/\/[^/]+\//, '')}${lineno ? `:${lineno}` : ''}`
      : '';
  return [screen ? `screen ${screen}` : '', at ? `at ${at}` : ''].filter(Boolean).join(' · ');
}

export function crashMessage(msg: string, where: string): string {
  return (where ? `${msg} · ${where}` : msg).slice(0, 300);
}

const IGNORED_ERRORS = /ResizeObserver loop|Script error\.?$|AbortError|The user aborted|Load failed$/i;

/** Report uncaught crashes once per message (installed from index.tsx). */
export function installCrashReporter(): void {
  if (typeof window === 'undefined' || (window as any).__plccCrashReporter) return;
  (window as any).__plccCrashReporter = true;
  primeDeviceDetails();
  void bearer();
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      cachedToken = session?.access_token || null;
    });
  } catch {
    /* ignore */
  }
  const roomFromPath = () => {
    const m = /\/community\/chat\/([0-9a-f-]{36})/i.exec(location.pathname);
    return m ? m[1] : null;
  };
  window.addEventListener('error', (e) => {
    const msg = String(e?.message || '');
    if (!msg || IGNORED_ERRORS.test(msg)) return;
    const where = crashWhere((e as ErrorEvent)?.error, (e as ErrorEvent)?.filename, (e as ErrorEvent)?.lineno);
    reportIssue({ area: 'app', code: 'app_crash', message: crashMessage(msg, where), channelId: roomFromPath() });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = e?.reason;
    const msg = String((r && (r.message || r)) || '');
    if (!msg || IGNORED_ERRORS.test(msg)) return;
    reportIssue({ area: 'app', code: 'app_crash', message: crashMessage(msg, crashWhere(r)), channelId: roomFromPath() });
  });
}

export type IssueRow = {
  id: string;
  at: string;
  kind: 'problem' | 'activity';
  severity: 'info' | 'warning' | 'critical';
  area: string;
  code: string;
  title: string;
  message: string | null;
  status: number | null;
  source: string | null;
  path: string | null;
  device: string | null;
  userName: string | null;
  channelId: string | null;
  channelName: string | null;
  /** Opaque per-person key (not a member id). */
  who?: string | null;
  extra?: IssueExtra | null;
  /** What to do about it (sign-in problems carry Canaan's own advice). */
  fix?: string | null;
};

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const token = await bearer();
  if (!token) return { status: 401, body: null };
  const res = await fetch(path, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** May the signed-in person open Issues? (Pastors, admins, Ka Link team admins.) */
export async function canViewIssues(): Promise<boolean> {
  try {
    const { body } = await getJson('/api/community-chat?resource=issues&check=1');
    return body?.allowed === true;
  } catch {
    return false;
  }
}

export async function fetchIssues(days: number): Promise<IssueRow[]> {
  const { status, body } = await getJson(`/api/community-chat?resource=issues&days=${days}`);
  if (status === 403) throw new Error('Only church leaders can see Issues.');
  if (status === 401) throw new Error('Please sign in again.');
  if (!body?.ok) throw new Error(body?.message || 'Could not load issues. Please try again.');
  return Array.isArray(body.issues) ? body.issues : [];
}
