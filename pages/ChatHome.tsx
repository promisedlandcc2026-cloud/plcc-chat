import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, MessageCircle } from 'lucide-react';

const CommunityChatPage = lazy(() =>
  import('./CommunityChat').then((m) => ({ default: m.CommunityChatPage }))
);
const CommunityChatRoomPage = lazy(() =>
  import('./CommunityChatRoom').then((m) => ({ default: m.CommunityChatRoomPage }))
);

const DESKTOP_QUERY = '(min-width: 1024px)';

/** True on laptops/desktops/large tablets in landscape. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(DESKTOP_QUERY).matches === true
  );
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP_QUERY);
    if (!mq) return;
    const on = () => setDesktop(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return desktop;
}

const Pending: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex-1 flex items-center justify-center gap-2 py-24 text-gray-500" role="status">
    <Loader2 className="animate-spin text-burgundy" size={22} aria-hidden />
    {label}
  </div>
);

/**
 * Phones: one screen at a time (rooms list, or the open conversation).
 * Desktop: rooms list on the left, the open conversation on the right — like WhatsApp on a computer.
 */
export const ChatHome: React.FC = () => {
  const { channelId } = useParams();
  const desktop = useIsDesktop();

  if (!desktop) {
    return (
      <Suspense fallback={<Pending label="Loading Chat…" />}>
        {channelId ? <CommunityChatRoomPage key={channelId} /> : <CommunityChatPage />}
      </Suspense>
    );
  }

  return (
    <div className="h-[100dvh] min-w-0 overflow-hidden grid grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="chat-workspace-sidebar h-[100dvh] min-w-0 overflow-y-auto border-r border-[#345343] bg-[#082d1d] flex flex-col" aria-label="Chats">
        <div className="flex-1">
          <Suspense fallback={<Pending label="Loading chats…" />}>
            <CommunityChatPage />
          </Suspense>
        </div>
      </aside>
      <section className="h-[100dvh] min-w-0 overflow-hidden flex flex-col bg-[#f8f3eb]" aria-label="Conversation">
        {channelId ? (
          <Suspense fallback={<Pending label="Opening chat…" />}>
            <CommunityChatRoomPage key={channelId} />
          </Suspense>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-10 text-gray-500">
            <MessageCircle size={48} className="text-burgundy/40 mb-4" aria-hidden />
            <p className="text-lg font-bold text-[#1A1A1A]">PLCC Ka Link</p>
            <p className="text-sm mt-1 max-w-sm">
              Pick a room or a person on the left to start chatting. Live Ka Links open right here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
