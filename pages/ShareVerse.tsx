import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Megaphone, Search, Send, User, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  fetchChatChannels,
  fetchDmList,
  fetchRoomInfo,
  openDirectMessage,
  searchChatDirectory,
  sendChatMessage,
  type ChatDmConversation,
} from '../lib/communityChatClient';
import { isDmChannel, type ChatDirectoryMember, type CommunityChatChannel } from '../lib/communityChatTypes';
import { CHAT_LEADER_ROLES } from '../lib/chatRoles';
import { buildVerseMessage, fetchVerse, passageFromParams, type SharedVerse } from '../lib/verseShare';
import { VerseCard } from '../components/chat/VerseCard';

type Target =
  | { kind: 'room'; id: string; name: string; announceOnly: boolean }
  | { kind: 'dm'; id: string; name: string }
  | { kind: 'person'; partnerId: string; name: string };

const targetKey = (t: Target) => (t.kind === 'person' ? `p:${t.partnerId}` : `${t.kind}:${t.id}`);

/**
 * /share?kind=verse&t=eng_kjv&b=JHN&c=1&v=10-11 — "Share to PLCC Ka Link" from the church Bible reader.
 * Pick a room or a person, see the verse, add a message, Send.
 */
export const ShareVerse: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const passage = useMemo(() => passageFromParams(params), [params]);
  const isLeader = CHAT_LEADER_ROLES.has(String(identity?.role || '').toUpperCase());

  const [verse, setVerse] = useState<SharedVerse | null>(null);
  const [rooms, setRooms] = useState<CommunityChatChannel[] | null>(null);
  const [dms, setDms] = useState<ChatDmConversation[]>([]);
  const [people, setPeople] = useState<ChatDirectoryMember[]>([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Target | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passage) return;
    const ctrl = new AbortController();
    fetchVerse(passage, ctrl.signal)
      .then(setVerse)
      .catch((e) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : 'Could not load that passage.'));
    fetchChatChannels()
      .then((list) => setRooms(list.filter((r) => !isDmChannel(r) && (!r.announceOnly || isLeader))))
      .catch(() => setRooms([]));
    fetchDmList().then((list) => setDms(list || []));
    return () => ctrl.abort();
  }, [passage, isLeader]);

  // People search starts a new personal conversation.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setPeople([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      searchChatDirectory(term, { signal: ctrl.signal })
        .then((list) => setPeople(list.filter((p) => p.id !== identity?.id).slice(0, 8)))
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [q, identity?.id]);

  const term = q.trim().toLowerCase();
  const shownDms = dms.filter((d) => !term || d.partnerName.toLowerCase().includes(term)).slice(0, 8);
  const shownRooms = (rooms || []).filter((r) => !term || r.name.toLowerCase().includes(term)).slice(0, 40);
  const dmPartnerIds = new Set(dms.map((d) => d.partnerId));
  const newPeople = people.filter((p) => !dmPartnerIds.has(p.id));

  const pick = async (t: Target) => {
    setError(null);
    setPicked(t);
    // Announcement rooms: confirm this member may post before offering Send.
    if (t.kind === 'room' && t.announceOnly) {
      setChecking(true);
      const info = await fetchRoomInfo(t.id).catch(() => null);
      setChecking(false);
      if (info && !info.canPost) {
        setPicked(null);
        setError(`Only leaders can post in ${t.name}.`);
      }
    }
  };

  const send = async () => {
    if (!picked || !verse || busy) return;
    setBusy(true);
    setError(null);
    try {
      let channelId = picked.kind === 'person' ? '' : picked.id;
      if (picked.kind === 'person') channelId = (await openDirectMessage(picked.partnerId)).channel.id;
      await sendChatMessage(channelId, buildVerseMessage(note, verse));
      navigate(`/community/chat/${channelId}`, { replace: true, state: { channelName: picked.name } });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not send that. Please try again.');
      setBusy(false);
    }
  };

  const Row: React.FC<{ t: Target; icon: React.ReactNode; sub?: string }> = ({ t, icon, sub }) => {
    const on = picked ? targetKey(picked) === targetKey(t) : false;
    return (
      <li>
        <button
          type="button"
          onClick={() => void pick(t)}
          aria-pressed={on}
          className={`w-full min-h-[56px] rounded-2xl border-2 px-4 py-2 flex items-center gap-3 text-left ${on ? 'border-burgundy bg-burgundy/5' : 'border-gray-200 bg-white'}`}
        >
          {icon}
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-[#1A1A1A] truncate">{t.name}</span>
            {sub ? <span className="block text-xs text-gray-500 truncate">{sub}</span> : null}
          </span>
        </button>
      </li>
    );
  };

  if (!passage) {
    return (
      <main className="flex-1 w-full max-w-[520px] mx-auto px-5 pt-6 pb-10">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Share to PLCC Ka Link</h1>
        <p className="mt-3 text-base text-burgundy">That link isn’t complete. Please go back to the Bible and try again.</p>
      </main>
    );
  }

  return (
    <main className="flex-1 w-full max-w-[520px] mx-auto px-5 pt-6 pb-10 flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-[#1A1A1A]">Share to PLCC Ka Link</h1>

      {verse ? (
        <VerseCard verse={verse} />
      ) : !error ? (
        <p className="py-6 flex justify-center text-burgundy" role="status">
          <Loader2 className="animate-spin" aria-label="Loading the verse" />
        </p>
      ) : null}

      <section aria-labelledby="share-to">
        <p id="share-to" className="text-sm font-bold text-[#1A1A1A] mb-1.5">Send to</p>
        <label className="relative block mb-3">
          <span className="sr-only">Search people and chats</span>
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people and chats"
            className="w-full min-h-[52px] rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
          />
        </label>

        {!rooms ? (
          <p className="py-8 flex justify-center text-burgundy" role="status">
            <Loader2 className="animate-spin" aria-label="Loading chats" />
          </p>
        ) : (
          <div className="max-h-[42vh] overflow-y-auto space-y-4 pr-1">
            {shownDms.length || newPeople.length ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">People</p>
                <ul className="space-y-2">
                  {shownDms.map((d) => (
                    <Row key={d.channelId} t={{ kind: 'dm', id: d.channelId, name: d.partnerName }} icon={<User size={18} className="text-burgundy shrink-0" aria-hidden />} sub="Personal conversation" />
                  ))}
                  {newPeople.map((p) => (
                    <Row key={p.id} t={{ kind: 'person', partnerId: p.id, name: p.name }} icon={<User size={18} className="text-burgundy shrink-0" aria-hidden />} sub="Start a personal conversation" />
                  ))}
                </ul>
              </div>
            ) : null}
            {shownRooms.length ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">Channels</p>
                <ul className="space-y-2">
                  {shownRooms.map((r) => (
                    <Row
                      key={r.id}
                      t={{ kind: 'room', id: r.id, name: r.name, announceOnly: Boolean(r.announceOnly) }}
                      icon={r.announceOnly ? <Megaphone size={18} className="text-gold-ink shrink-0" aria-hidden /> : <Users size={18} className="text-burgundy shrink-0" aria-hidden />}
                      sub={r.announceOnly ? 'Announcements' : undefined}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            {!shownDms.length && !newPeople.length && !shownRooms.length ? (
              <p className="text-sm text-gray-500 py-6 text-center">{term.length === 1 ? 'Keep typing to search people.' : 'No people or chats found.'}</p>
            ) : null}
          </div>
        )}
      </section>

      {picked ? (
        <div>
          <label htmlFor="share-note" className="block text-sm font-bold text-[#1A1A1A] mb-1.5">
            Add a message <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <textarea
            id="share-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={picked.kind === 'room' ? 'Why this verse speaks to you…' : `A word for ${picked.name.split(' ')[0]}…`}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
          />
        </div>
      ) : null}

      {error ? <p className="text-sm font-medium text-burgundy" role="alert">{error}</p> : null}

      <button
        type="button"
        onClick={() => void send()}
        disabled={!picked || !verse || busy || checking}
        className="w-full min-h-[56px] rounded-2xl bg-burgundy text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {busy || checking ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Send size={20} aria-hidden />}
        Send{picked ? ` to ${picked.name}` : ''}
      </button>
      <Link to="/community/chat" className="text-center text-sm font-bold text-burgundy underline underline-offset-2 min-h-[44px] flex items-center justify-center">
        Not now — go to my chats
      </Link>
    </main>
  );
};

export default ShareVerse;
