import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, HandHeart, Loader2, Megaphone, Search, Users } from 'lucide-react';
import { fetchCardOptions, fetchChatChannels, shareCard } from '../lib/communityChatClient';
import type { CommunityChatChannel } from '../lib/communityChatTypes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /share?kind=event|serve&id=…  — opened from PLCC Connect or the Vault ("Share to PLCC Chat").
 * Pick a chat, add a note, and the event or Serve need posts there as a card.
 */
export const ShareToChat: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get('kind') === 'serve' ? 'serve' : 'event';
  const refId = String(params.get('id') || '');
  const valid = UUID_RE.test(refId);

  const [title, setTitle] = useState<string | null>(null);
  const [rooms, setRooms] = useState<CommunityChatChannel[] | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<CommunityChatChannel | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    fetchCardOptions()
      .then((o) => {
        if (!alive) return;
        const hit = kind === 'event' ? o.events.find((e) => e.id === refId) : o.serve.find((s) => s.id === refId);
        setTitle(hit?.title || null);
        if (!hit) setError(kind === 'event' ? 'That event is not on the upcoming calendar.' : 'That Serve need is not open.');
      })
      .catch(() => alive && setError('Could not load that right now. Please try again.'));
    fetchChatChannels()
      .then((list) => alive && setRooms(list))
      .catch(() => alive && setRooms([]));
    return () => {
      alive = false;
    };
  }, [kind, refId, valid]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rooms || []).filter((r) => !t || r.name.toLowerCase().includes(t)).slice(0, 60);
  }, [rooms, q]);

  const share = async () => {
    if (!picked || !title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await shareCard(picked.id, kind, refId, title, note);
      navigate(`/community/chat/${picked.id}`, { replace: true, state: { channelName: picked.name } });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not share that. Please try again.');
      setBusy(false);
    }
  };

  const Icon = kind === 'event' ? CalendarDays : HandHeart;

  return (
    <main className="flex-1 w-full max-w-[500px] mx-auto px-5 pt-6 pb-10 flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-[#1A1A1A]">Share to PLCC Chat</h1>

      {!valid ? (
        <p className="text-base text-burgundy">That link isn’t complete. Please go back and try again.</p>
      ) : (
        <>
          <div className="rounded-2xl bg-white border border-gray-200 p-4 flex items-center gap-3">
            <span className="h-12 w-12 shrink-0 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center" aria-hidden>
              <Icon size={24} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-burgundy">{kind === 'event' ? 'Event' : 'Volunteers needed'}</p>
              <p className="text-[17px] font-bold text-[#1A1A1A]">{title || (error ? '—' : 'Loading…')}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-[#1A1A1A] mb-1.5">Pick a chat</p>
            <label className="relative block mb-2">
              <span className="sr-only">Search chats</span>
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search chats"
                className="w-full min-h-[52px] rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
              />
            </label>
            {!rooms ? (
              <p className="py-8 flex justify-center text-burgundy" role="status">
                <Loader2 className="animate-spin" aria-label="Loading chats" />
              </p>
            ) : shown.length ? (
              <ul className="space-y-2 max-h-[45vh] overflow-y-auto">
                {shown.map((r) => {
                  const on = picked?.id === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(r)}
                        aria-pressed={on}
                        className={`w-full min-h-[56px] rounded-2xl border-2 px-4 flex items-center gap-3 text-left ${
                          on ? 'border-burgundy bg-burgundy/5' : 'border-gray-200 bg-white'
                        }`}
                      >
                        {r.announceOnly ? <Megaphone size={18} className="text-gold-ink" aria-hidden /> : <Users size={18} className="text-burgundy" aria-hidden />}
                        <span className="text-[15px] font-bold text-[#1A1A1A]">{r.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 py-6 text-center">No chats found.</p>
            )}
          </div>

          {picked ? (
            <div>
              <label htmlFor="share-note" className="block text-sm font-bold text-[#1A1A1A] mb-1.5">Add a note (optional)</label>
              <input
                id="share-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                className="w-full min-h-[52px] rounded-2xl border border-gray-200 bg-white px-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
              />
            </div>
          ) : null}

          {error ? <p className="text-sm font-medium text-burgundy" role="alert">{error}</p> : null}

          <button
            type="button"
            onClick={() => void share()}
            disabled={!picked || !title || busy}
            className="w-full min-h-[56px] rounded-2xl bg-burgundy text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : null}
            Share{picked ? ` to ${picked.name}` : ''}
          </button>
          <Link to="/community/chat" className="text-center text-sm font-bold text-burgundy underline underline-offset-2 min-h-[44px] flex items-center justify-center">
            Not now — go to my chats
          </Link>
        </>
      )}
    </main>
  );
};

export default ShareToChat;
