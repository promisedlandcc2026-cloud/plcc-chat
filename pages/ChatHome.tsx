import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

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
      <aside className="kl-sidebar chat-workspace-sidebar h-[100dvh] min-w-0 overflow-y-auto flex flex-col" aria-label="Chats">
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
          <div className="kl-empty-pane flex-1 flex flex-col items-center justify-center text-center px-10">
            <img src="/ka-link-gold-logo.png" alt="" width={168} height={56} className="kl-empty-logo" draggable={false} />
            <p className="mt-6 text-xl font-semibold text-[#14261c]">Welcome to PLCC Ka Link</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#5f6f64]">
              Choose a prayer gathering, ministry channel or person on the left. Live Ka Links open right here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
