import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Smartphone,
} from 'lucide-react';
import { canViewIssues, fetchIssues, type IssueRow } from '../lib/issueReport';
import {
  OUTCOME_LABEL,
  OUTCOME_TONE,
  buildPeople,
  buildSessions,
  contextLine,
  formatDuration,
  type HuddleSession,
  type Outcome,
  type PersonInSession,
  type PersonSummary,
} from '../lib/issuesInsights';
import { diagnosePerson, type Cause, type Diagnosis } from '../lib/issuesDiagnosis';

const TZ = 'America/New_York';
const RANGES = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];
type Tab = 'huddles' | 'people' | 'problems';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString('en-US', { timeZone: TZ });
  const now = new Date();
  const yest = new Date(now.getTime() - 86400_000);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(yest)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

function timeWithSeconds(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function groupByDay<T>(items: T[], at: (x: T) => string): Array<{ day: string; items: T[] }> {
  const out: Array<{ day: string; items: T[] }> = [];
  items.forEach((x) => {
    const day = dayLabel(at(x));
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(x);
    else out.push({ day, items: [x] });
  });
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  'ka-link-app': 'phone (Ka Link)',
  'tribes-app': 'phone (Tribes)',
  'ka-link-server': 'Ka Link server',
  'tribes-server': 'Tribes server',
  canaan: 'Canaan',
  livekit: 'call server',
};

const TONE_CLASS: Record<'bad' | 'warn' | 'ok' | 'neutral', string> = {
  bad: 'bg-red-50 text-red-800 border-red-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  neutral: 'bg-gray-50 text-gray-700 border-gray-200',
};

const OutcomeChip: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${TONE_CLASS[OUTCOME_TONE[outcome]]}`}
  >
    {OUTCOME_LABEL[outcome]}
  </span>
);

const SeverityIcon: React.FC<{ row: IssueRow }> = ({ row }) => {
  if (row.kind === 'activity') return <Info size={18} className="text-gray-400 shrink-0 mt-0.5" aria-label="Activity" />;
  if (row.severity === 'critical') return <CircleAlert size={18} className="text-red-600 shrink-0 mt-0.5" aria-label="Serious" />;
  return <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" aria-label="Problem" />;
};

/** Which app a phone report came from, shown before the device line. */
export function appLabel(source: string | null | undefined): string | null {
  if (source === 'tribes-app') return 'PLCC Tribes';
  if (source === 'ka-link-app') return 'PLCC Ka Link';
  return null;
}

function deviceLine(e: Pick<IssueRow, 'source' | 'device'>): string {
  return [appLabel(e.source), e.device].filter(Boolean).join(' · ');
}

/** One line in a person's timeline. */
const TimelineItem: React.FC<{ e: IssueRow }> = ({ e }) => {
  const server = e.source === 'livekit';
  const ctx = contextLine(e.extra);
  const bad = e.kind === 'problem' || (server && e.severity === 'warning') || e.code === 'huddle_dropped';
  return (
    <li className="flex gap-2 py-1.5">
      <span className="w-[74px] shrink-0 text-xs text-gray-500 pt-0.5 tabular-nums">{timeWithSeconds(e.at)}</span>
      <span className="shrink-0 pt-0.5" aria-label={server ? 'Call server' : 'Phone'}>
        {server ? <Server size={13} className="text-gray-400" /> : <Smartphone size={13} className="text-gray-400" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[13px] ${bad ? 'text-red-800 font-semibold' : 'text-[#1A1A1A]'}`}>{e.title}</span>
        {e.message && e.message !== e.title ? <span className="block text-xs text-gray-600">{e.message}</span> : null}
        {ctx ? <span className="block text-xs text-gray-500">{ctx}</span> : null}
        {!server && deviceLine(e) ? <span className="block text-xs text-gray-400">{deviceLine(e)}</span> : null}
      </span>
    </li>
  );
};

const PersonRow: React.FC<{ p: PersonInSession }> = ({ p }) => {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left flex gap-2" aria-expanded={open}>
        {open ? <ChevronDown size={16} className="mt-1 text-gray-400 shrink-0" /> : <ChevronRight size={16} className="mt-1 text-gray-400 shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-bold text-[#1A1A1A] truncate">{p.name}</span>
            <span className="text-xs text-gray-500 shrink-0">{formatDuration(p.seconds)}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <OutcomeChip outcome={p.outcome} />
            {p.drops ? (
              <span className="text-xs text-amber-800 font-semibold">
                {p.drops} connection {p.drops === 1 ? 'drop' : 'drops'}
              </span>
            ) : null}
            {p.joins > 1 ? <span className="text-xs text-gray-600">joined {p.joins}×</span> : null}
            {p.interruptions ? (
              <span className="text-xs text-amber-800">
                · audio paused by a phone call {p.interruptions}×
                {p.interruptionsRecovered < p.interruptions ? ' (didn’t come back)' : ''}
              </span>
            ) : null}
            {p.keepAwake ? <span className="text-xs text-gray-600">· keep awake on</span> : null}
            {p.lowBattery != null ? <span className="text-xs text-red-700">· battery {p.lowBattery}%</span> : null}
          </span>
          <span className="block text-xs text-gray-500 mt-0.5 truncate">
            {p.devices[0] || 'Device not reported'}
            {p.devices.length > 1 ? ` (+${p.devices.length - 1} more)` : ''}
            {' · '}
            {timeLabel(p.firstSeen)}–{timeLabel(p.lastSeen)}
          </span>
          {p.outcomeDetail ? <span className="block text-xs text-gray-600 mt-0.5">{p.outcomeDetail}</span> : null}
        </span>
      </button>
      {open ? (
        <ul className="mt-1 ml-6 border-l border-gray-200 pl-3">
          {p.events.map((e) => (
            <TimelineItem key={e.id} e={e} />
          ))}
        </ul>
      ) : null}
    </li>
  );
};

const SessionCard: React.FC<{ s: HuddleSession; defaultOpen: boolean }> = ({ s, defaultOpen }) => {
  const [open, setOpen] = useState(defaultOpen);
  const minutes = Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000);
  const real = s.people.filter((p) => p.name !== 'Someone' || p.events.some((e) => e.code !== 'Live Huddle started'));
  return (
    <section className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 hover:bg-gray-50" aria-expanded={open}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-extrabold text-[#1A1A1A] truncate">{s.channelName}</span>
          <span className="text-xs text-gray-500 shrink-0">
            {timeLabel(s.startedAt)}–{s.open ? 'now' : timeLabel(s.endedAt)}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          <span>
            {real.length} {real.length === 1 ? 'person' : 'people'}
          </span>
          {minutes > 0 ? <span>{formatDuration(minutes * 60)}</span> : null}
          {s.open ? <span className="text-emerald-700 font-bold">● Live</span> : null}
          {s.kickedOut ? (
            <span className="text-red-700 font-bold">
              {s.kickedOut} kicked out / lost
            </span>
          ) : null}
          {s.drops ? <span className="text-amber-800 font-semibold">{s.drops} drops</span> : null}
          {s.startedBy ? <span>started by {s.startedBy}</span> : null}
        </span>
      </button>
      {open ? (
        <ul className="px-4 pb-2 divide-y divide-gray-100 border-t border-gray-100">
          {real.map((p) => (
            <PersonRow key={p.key} p={p} />
          ))}
        </ul>
      ) : null}
    </section>
  );
};

const CAUSE_LABEL: Record<Cause, string> = {
  phone: 'Phone / how it’s used',
  connection: 'Internet connection',
  app: 'App problem — on us',
  info: 'Good to know',
};
const CAUSE_CLASS: Record<Cause, string> = {
  phone: 'bg-amber-100 text-amber-900',
  connection: 'bg-sky-100 text-sky-900',
  app: 'bg-red-100 text-red-800',
  info: 'bg-gray-100 text-gray-700',
};
const VERDICT_CLASS: Record<Diagnosis['verdict'], string> = {
  phone: 'border-amber-300 bg-amber-50',
  connection: 'border-sky-300 bg-sky-50',
  app: 'border-red-300 bg-red-50',
  mixed: 'border-amber-300 bg-amber-50',
  fine: 'border-emerald-300 bg-emerald-50',
};

/** People → "What happened and why": plain-English findings with proof, cause and fix. */
const WhyPanel: React.FC<{ d: Diagnosis; name: string }> = ({ d, name }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!d.findings.length) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.whatsapp);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="px-4 pb-3" data-issues-why="true">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`w-full min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm ${VERDICT_CLASS[d.verdict]}`}
      >
        <span className="flex items-center gap-1.5 font-bold text-[#1A1A1A]">
          {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          What happened and why
        </span>
        <span className="block text-[13px] text-gray-700 mt-0.5">{d.summary}</span>
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
          <p className="font-bold text-[#1A1A1A]">{name}</p>
          <ul className="mt-1 space-y-2.5 list-disc pl-5 text-sm text-[#1A1A1A]">
            {d.findings.map((f, i) => (
              <li key={i}>
                <span className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-bold align-middle ${CAUSE_CLASS[f.cause]}`}>
                  {CAUSE_LABEL[f.cause]}
                </span>
                {f.text}
                {f.fix ? (
                  <span className="block mt-0.5 text-[13px] text-emerald-800">
                    <span className="font-bold">Fix:</span> {f.fix}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {d.whatsapp ? (
            <button
              type="button"
              onClick={() => void copy()}
              className="mt-3 w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold"
            >
              {copied ? 'Copied ✓ — paste it in WhatsApp' : `Copy WhatsApp tips for ${name.split(/\s+/)[0]}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const PeopleList: React.FC<{
  people: PersonSummary[];
  onPick: (name: string) => void;
  why: Map<string, Diagnosis>;
}> = ({ people, onPick, why }) => (
  <ul className="rounded-2xl bg-white border border-gray-200 divide-y divide-gray-100 overflow-hidden">
    {people.map((p) => (
      <li key={p.key}>
        <button type="button" onClick={() => onPick(p.name)} className="w-full text-left px-4 py-3 hover:bg-gray-50">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-bold text-[#1A1A1A] truncate">{p.name}</span>
            <span className="text-xs text-gray-500 shrink-0">
              last seen {dayLabel(p.lastSeen).toLowerCase() === 'today' ? 'today' : dayLabel(p.lastSeen)} {timeLabel(p.lastSeen)}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
            <span>
              {p.huddles} {p.huddles === 1 ? 'huddle' : 'huddles'}
            </span>
            {p.seconds ? <span>{formatDuration(p.seconds)} on calls</span> : null}
            {p.troubles ? <span className="text-red-700 font-bold">kicked out / lost {p.troubles}×</span> : null}
            {p.drops ? <span className="text-amber-800 font-semibold">{p.drops} drops</span> : null}
            {p.problems ? <span className="text-amber-800">{p.problems} problems</span> : null}
          </span>
          <span className="block text-xs text-gray-500 mt-1 truncate">{p.devices.join(' · ') || 'Device not reported'}</span>
          {p.huddles ? (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
              Last huddle ({p.lastRoom}): <OutcomeChip outcome={p.lastOutcome} />
            </span>
          ) : null}
        </button>
        {why.get(p.key) ? <WhyPanel d={why.get(p.key)!} name={p.name} /> : null}
      </li>
    ))}
  </ul>
);

/**
 * /issues — owner-only. Three views of the same log:
 *   Huddles  — each call, who was on it and how each person's time ended.
 *   People   — every member across the range: time on calls, drops, devices.
 *   Problems — things that went wrong anywhere in Ka Link, Tribes or signing in.
 */
export const IssuesPage: React.FC = () => {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<IssueRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('huddles');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void canViewIssues().then((ok) => alive && setAllowed(ok));
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchIssues(days));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load issues.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const t = q.trim().toLowerCase();
  const matches = useCallback(
    (vals: Array<string | null | undefined>) => !t || vals.filter(Boolean).some((v) => String(v).toLowerCase().includes(t)),
    [t]
  );

  const sessions = useMemo(() => buildSessions(rows || []), [rows]);
  const people = useMemo(() => buildPeople(sessions, rows || []), [sessions, rows]);

  const shownSessions = useMemo(() => {
    if (!t) return sessions;
    return sessions
      .map((s) => {
        if (matches([s.channelName])) return s;
        const ppl = s.people.filter((p) => matches([p.name, ...p.devices]));
        return ppl.length ? { ...s, people: ppl } : null;
      })
      .filter(Boolean) as HuddleSession[];
  }, [sessions, matches, t]);

  const why = useMemo(() => {
    const m = new Map<string, Diagnosis>();
    for (const p of people) m.set(p.key, diagnosePerson(p.key, rows || [], sessions));
    return m;
  }, [people, rows, sessions]);

  const shownPeople = useMemo(() => people.filter((p) => matches([p.name, p.lastRoom, ...p.devices])), [people, matches]);

  const problems = useMemo(
    () =>
      (rows || []).filter(
        (r) => r.kind === 'problem' && matches([r.channelName, r.userName, r.title, r.code, r.message, r.device])
      ),
    [rows, matches]
  );

  const hotRooms = useMemo(() => {
    const counts = new Map<string, { name: string; n: number; people: Set<string> }>();
    (rows || []).forEach((r) => {
      if (r.kind !== 'problem') return;
      const k = r.channelId || 'none';
      const c = counts.get(k) || { name: r.channelName || (r.channelId ? 'Room' : 'No room'), n: 0, people: new Set<string>() };
      c.n += 1;
      if (r.userName) c.people.add(r.userName);
      counts.set(k, c);
    });
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  }, [rows]);

  if (allowed === null) {
    return (
      <div className="flex-1 flex items-center justify-center py-24" role="status">
        <Loader2 className="animate-spin text-burgundy" size={32} aria-label="Loading" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <p className="text-lg font-bold text-[#1A1A1A]">This page isn’t available.</p>
        <Link to="/community/chat" className="text-burgundy font-bold underline">
          Back to Chat
        </Link>
      </div>
    );
  }

  const rangeLabel = RANGES.find((r) => r.days === days)?.label;
  const kicked = sessions.reduce((n, s) => n + s.kickedOut, 0);
  const totalPeople = people.filter((p) => p.huddles > 0).length;
  const TABS: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'huddles', label: 'Huddles', count: sessions.length },
    { id: 'people', label: 'People', count: people.length },
    { id: 'problems', label: 'Problems', count: (rows || []).filter((r) => r.kind === 'problem').length },
  ];

  return (
    <div className="flex-1 flex flex-col w-full max-w-[760px] mx-auto">
      <header className="sticky top-0 z-10 bg-eggshell/95 backdrop-blur border-b border-gray-200 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-2">
          <Link
            to="/community/chat"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-white"
            aria-label="Back to Chat"
          >
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold text-[#1A1A1A]">Issues</h1>
            <p className="text-xs text-gray-500">Church leaders only page · times are Eastern</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border border-gray-200 bg-white disabled:opacity-60"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-white border border-gray-200 p-1" role="tablist">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`min-h-[40px] rounded-lg text-sm font-bold ${
                tab === x.id ? 'bg-burgundy text-white' : 'text-[#1A1A1A] hover:bg-gray-50'
              }`}
            >
              {x.label}
              {rows ? <span className={`ml-1 text-xs ${tab === x.id ? 'text-white/80' : 'text-gray-500'}`}>{x.count}</span> : null}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`min-h-[36px] px-3 rounded-full text-sm font-bold border ${
                days === r.days ? 'bg-burgundy text-white border-burgundy' : 'bg-white text-[#1A1A1A] border-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mt-3 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by room, person or phone (e.g. Mount Moriah, iPhone)"
            className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 bg-white text-base"
            aria-label="Filter"
          />
        </div>
      </header>

      <main className="px-4 py-4 space-y-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {error ? <p className="rounded-xl bg-red-50 text-red-800 text-sm px-4 py-3">{error}</p> : null}

        {!rows && loading ? (
          <div className="flex justify-center py-16" role="status">
            <Loader2 className="animate-spin text-burgundy" size={28} aria-label="Loading" />
          </div>
        ) : null}

        {rows && !error && tab === 'huddles' ? (
          <>
            <section className="rounded-2xl bg-white border border-gray-200 p-4 text-sm text-gray-600">
              <span className="text-2xl font-extrabold text-[#1A1A1A] mr-1">{sessions.length}</span>
              {sessions.length === 1 ? 'huddle' : 'huddles'} · {totalPeople} {totalPeople === 1 ? 'person' : 'people'} in the last {rangeLabel}
              {kicked ? (
                <p className="mt-1 text-red-700 font-bold">
                  {kicked} {kicked === 1 ? 'time' : 'times'} someone was kicked out or lost the call
                </p>
              ) : (
                <p className="mt-1">Nobody was kicked out. 🙌</p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Tap a huddle to see everyone on it, then tap a person for their minute-by-minute timeline.{' '}
                <Smartphone size={11} className="inline" /> = what their phone reported,{' '}
                <Server size={11} className="inline" /> = what the call server saw.
              </p>
            </section>
            {!shownSessions.length ? <p className="text-center text-sm text-gray-500 py-8">No huddles in this range.</p> : null}
            {groupByDay<HuddleSession>(shownSessions, (s) => s.startedAt).map((g) => (
              <div key={g.day} className="space-y-2">
                <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-500">{g.day}</h2>
                {g.items.map((s, i) => (
                  <SessionCard key={s.id} s={s} defaultOpen={Boolean(t) || (g.day === 'Today' && i === 0) || s.kickedOut > 0} />
                ))}
              </div>
            ))}
          </>
        ) : null}

        {rows && !error && tab === 'people' ? (
          <>
            <p className="text-xs text-gray-500">
              Everyone seen in the last {rangeLabel}, people who had trouble first. Tap a name to see their huddles, or
              open <b>What happened and why</b> for a plain explanation of each problem: whether it was the phone, the
              internet connection or the app, with dates and times as proof.
            </p>
            {shownPeople.length ? (
              <PeopleList
                people={shownPeople}
                why={why}
                onPick={(name) => {
                  setQ(name);
                  setTab('huddles');
                }}
              />
            ) : (
              <p className="text-center text-sm text-gray-500 py-8">No matching people.</p>
            )}
          </>
        ) : null}

        {rows && !error && tab === 'problems' ? (
          <>
            <section className="rounded-2xl bg-white border border-gray-200 p-4">
              <p className="text-sm text-gray-600">
                <span className="text-2xl font-extrabold text-[#1A1A1A] mr-1">{TABS[2].count}</span>
                problem{TABS[2].count === 1 ? '' : 's'} in the last {rangeLabel}
              </p>
              {hotRooms.length ? (
                <ul className="mt-3 space-y-1.5">
                  {hotRooms.map((r) => (
                    <li key={r.name}>
                      <button
                        type="button"
                        onClick={() => setQ(r.name === 'No room' ? '' : r.name)}
                        className="w-full flex items-center justify-between text-left text-sm min-h-[36px] px-3 rounded-lg bg-eggshell hover:bg-gray-100"
                      >
                        <span className="font-bold text-[#1A1A1A] truncate">{r.name}</span>
                        <span className="text-gray-600 shrink-0 ml-2">
                          {r.n} · {r.people.size} {r.people.size === 1 ? 'person' : 'people'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-gray-600">Nothing has gone wrong. 🙌</p>
              )}
            </section>

            {!problems.length ? <p className="text-center text-sm text-gray-500 py-8">No matching problems.</p> : null}

            {groupByDay<IssueRow>(problems, (r) => r.at).map((g) => (
              <section key={g.day}>
                <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-500 mb-2">{g.day}</h2>
                <ul className="rounded-2xl bg-white border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                  {g.items.map((r) => {
                    const expanded = openId === r.id;
                    const ctx = contextLine(r.extra);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setOpenId(expanded ? null : r.id)}
                          className="w-full text-left px-4 py-3 flex gap-3 hover:bg-gray-50"
                          aria-expanded={expanded}
                        >
                          <SeverityIcon row={r} />
                          <span className="flex-1 min-w-0">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="font-bold text-[#1A1A1A] truncate">
                                {r.userName || 'Someone'}
                                {r.channelName ? <span className="font-semibold text-gray-500"> · {r.channelName}</span> : null}
                              </span>
                              <span className="text-xs text-gray-500 shrink-0">{timeLabel(r.at)}</span>
                            </span>
                            <span className="block text-sm text-[#1A1A1A] mt-0.5">{r.title}</span>
                            {deviceLine(r) ? <span className="block text-xs text-gray-500 mt-0.5 truncate">{deviceLine(r)}</span> : null}
                            {expanded ? (
                              <span className="block mt-2 text-xs text-gray-600 space-y-1">
                                {r.message && r.message !== r.title ? <span className="block">Detail: {r.message}</span> : null}
                                {r.fix ? <span className="block font-semibold text-emerald-800">Fix: {r.fix}</span> : null}
                                {ctx ? <span className="block">On: {ctx}</span> : null}
                                {typeof r.extra?.durationSec === 'number' ? (
                                  <span className="block">Had been on the call {formatDuration(r.extra.durationSec)}</span>
                                ) : null}
                                <span className="block">
                                  Code: <code>{r.code}</code>
                                  {r.status ? ` · status ${r.status}` : ''}
                                  {r.source ? ` · seen by ${SOURCE_LABEL[r.source] || r.source}` : ''}
                                </span>
                                {r.path ? <span className="block">Screen: {r.path}</span> : null}
                                <span className="block">
                                  {new Date(r.at).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'medium' })}
                                </span>
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        ) : null}
      </main>
    </div>
  );
};
