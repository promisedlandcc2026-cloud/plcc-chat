import React, { useEffect, useState } from 'react';
import { CalendarDays, HandHeart, Loader2, X } from 'lucide-react';
import { Portal } from './Portal';
import { fetchCardOptions } from '../../lib/communityChatClient';
import type { ChatCardOptions } from '../../lib/communityChatTypes';

const TZ = 'Africa/Kampala';

function shortWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

/** "Share an event / Serve need": pick one from the Vault, add an optional note, send. */
export const CardPickerSheet: React.FC<{
  onCancel: () => void;
  onShare: (pick: { kind: 'event' | 'serve'; id: string; title: string; note: string }) => Promise<void>;
}> = ({ onCancel, onShare }) => {
  const [tab, setTab] = useState<'event' | 'serve'>('event');
  const [options, setOptions] = useState<ChatCardOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ kind: 'event' | 'serve'; id: string; title: string } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCardOptions()
      .then((o) => alive && setOptions(o))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : 'Could not load events right now.'));
    return () => {
      alive = false;
    };
  }, []);

  const list =
    tab === 'event'
      ? (options?.events || []).map((e) => ({ id: e.id, title: e.title, sub: [shortWhen(e.startsAt), e.location].filter(Boolean).join(' · ') }))
      : (options?.serve || []).map((o) => ({ id: o.id, title: o.title, sub: [o.roleLabel, shortWhen(o.startsAt)].filter(Boolean).join(' · ') }));

  const send = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onShare({ ...picked, note });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not share that. Please try again.');
      setBusy(false);
    }
  };

  const tabBtn = (id: 'event' | 'serve', label: string, Icon: typeof CalendarDays) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => {
        setTab(id);
        setPicked(null);
      }}
      className={`flex-1 min-h-[48px] rounded-xl text-[15px] font-bold flex items-center justify-center gap-2 ${
        tab === id ? 'bg-burgundy text-white' : 'text-burgundy'
      }`}
    >
      <Icon size={18} aria-hidden /> {label}
    </button>
  );

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={busy ? undefined : onCancel}>
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="card-picker-title"
          className="w-full max-w-[500px] max-h-[92vh] flex flex-col rounded-t-3xl lg:rounded-3xl bg-white shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] gap-4"
        >
          <div className="flex items-center justify-between">
            <h2 id="card-picker-title" className="text-xl font-bold text-[#1A1A1A]">Share with the group</h2>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="min-h-[44px] min-w-[44px] rounded-full bg-gray-100 text-gray-700 flex items-center justify-center"
              aria-label="Cancel"
            >
              <X size={20} />
            </button>
          </div>

          <div role="tablist" className="flex gap-1 p-1 rounded-2xl bg-eggshell">
            {tabBtn('event', 'Event', CalendarDays)}
            {tabBtn('serve', 'Volunteers', HandHeart)}
          </div>

          <div className="flex-1 min-h-[180px] overflow-y-auto -mx-1 px-1">
            {loadError ? (
              <p className="text-sm text-burgundy py-6 text-center">{loadError}</p>
            ) : !options ? (
              <p className="py-10 flex justify-center text-burgundy" role="status">
                <Loader2 className="animate-spin" aria-label="Loading" />
              </p>
            ) : !list.length ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                {tab === 'event' ? 'No upcoming events on the calendar yet.' : 'No open volunteer needs right now.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {list.map((item) => {
                  const on = picked?.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setPicked({ kind: tab, id: item.id, title: item.title })}
                        aria-pressed={on}
                        className={`w-full min-h-[60px] rounded-2xl border-2 px-4 py-2.5 text-left ${
                          on ? 'border-burgundy bg-burgundy/5' : 'border-gray-200 bg-white'
                        }`}
                      >
                        <span className="block text-[15px] font-bold text-[#1A1A1A]">{item.title}</span>
                        {item.sub ? <span className="block text-sm text-gray-500">{item.sub}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {picked ? (
            <div>
              <label htmlFor="card-note" className="block text-sm font-bold text-[#1A1A1A] mb-1.5">Add a note (optional)</label>
              <input
                id="card-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder={picked.kind === 'event' ? 'e.g. Hope to see everyone there!' : 'e.g. We need 3 more ushers'}
                className="w-full min-h-[52px] rounded-2xl border border-gray-200 px-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
              />
            </div>
          ) : null}

          {error ? <p className="text-sm font-medium text-burgundy" role="alert">{error}</p> : null}

          <button
            type="button"
            onClick={() => void send()}
            disabled={!picked || busy}
            className="w-full min-h-[56px] rounded-2xl bg-burgundy text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : null}
            Share
          </button>
        </div>
      </div>
    </Portal>
  );
};
