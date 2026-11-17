import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Mic, Radio } from 'lucide-react';
import { fetchChatChannels, fetchHuddleStatuses } from '../lib/communityChatClient';
import { isDmChannel, isHuddleChannelLive } from '../lib/communityChatTypes';
import { huddleRoomPath } from '../lib/liveHuddles';

type LiveRoom = { id: string; name: string; count: number };

/**
 * /live — "Live prayer" from the church website or PLCC ONE.
 * One Live Huddle → straight to its Join card. Several → pick one. None → say so.
 * Only rooms this member can open are checked.
 */
export const LivePrayer: React.FC = () => {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const channels = (await fetchChatChannels({ signal: ctrl.signal })).filter((c) => !isDmChannel(c));
        const status: Record<string, unknown> = {};
        for (let i = 0; i < channels.length; i += 50) {
          Object.assign(status, await fetchHuddleStatuses(channels.slice(i, i + 50).map((c) => c.id), { signal: ctrl.signal }));
        }
        const live = channels
          .filter((c) => isHuddleChannelLive(status[c.id]))
          .map((c) => ({ id: c.id, name: c.name, count: (status[c.id] as { participantCount: number }).participantCount }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        if (live.length === 1) {
          navigate(huddleRoomPath(live[0].id, 'join'), { replace: true, state: { channelName: live[0].name } });
          return;
        }
        setRooms(live);
      } catch {
        if (!ctrl.signal.aborted) setError('Couldn’t check for live prayer right now. Please try again.');
      }
    })();
    return () => ctrl.abort();
  }, [navigate]);

  return (
    <main className="flex-1 w-full max-w-[500px] mx-auto px-5 pt-8 pb-10 flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-[#1A1A1A] flex items-center gap-2">
        <Radio size={24} className="text-burgundy" aria-hidden /> Live prayer
      </h1>

      {error ? (
        <p className="text-base font-medium text-burgundy" role="alert">{error}</p>
      ) : !rooms ? (
        <p className="py-10 flex flex-col items-center gap-3 text-gray-600" role="status">
          <Loader2 className="animate-spin text-burgundy" size={32} aria-hidden />
          Looking for a Live Ka Link…
        </p>
      ) : rooms.length ? (
        <>
          <p className="text-base text-gray-700">Several prayer rooms are live. Choose one to join.</p>
          <ul className="space-y-3">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link
                  to={huddleRoomPath(r.id, 'join')}
                  state={{ channelName: r.name }}
                  className="w-full min-h-[64px] rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 flex items-center gap-3 hover:border-burgundy"
                >
                  <span className="h-11 w-11 shrink-0 rounded-full bg-burgundy text-white flex items-center justify-center" aria-hidden>
                    <Mic size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-bold text-[#1A1A1A] truncate">{r.name}</span>
                    <span className="flex items-center gap-1.5 text-sm text-gray-600">
                      <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden /> Live · {r.count} {r.count === 1 ? 'person' : 'people'}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-burgundy px-4 py-2 text-sm font-bold text-white">Join</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="rounded-2xl bg-white border border-gray-200 p-6 text-center">
          <p className="text-lg font-bold text-[#1A1A1A]">No Live Ka Link right now</p>
          <p className="mt-1.5 text-base text-gray-600">
            When a prayer room goes live, you’ll find it at the top of your chats. Turn on message alerts so you don’t miss it.
          </p>
          <Link to="/community/chat" className="mt-5 inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-burgundy px-6 text-base font-bold text-white">
            Go to my chats
          </Link>
        </div>
      )}
    </main>
  );
};

export default LivePrayer;
