import React, { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronLeft, Loader2 } from 'lucide-react';
import type { BibleSelection } from '../components/bible/BibleReader';

const BibleReader = lazy(() => import('../components/bible/BibleReader'));

/**
 * The church Bible (English, Luganda — same Bibles as the website), as its own Ka Link
 * page so members can read it from the home screen, not only inside a Ka Link call.
 * Selected verses can be sent to any chat through the existing Share screen.
 */
export const BiblePage: React.FC = () => {
  const navigate = useNavigate();

  const shareToChat = (s: BibleSelection) => {
    const q = new URLSearchParams({ kind: 'verse', t: s.translationId, b: s.book, c: String(s.chapter) });
    q.set('v', s.from === s.to ? String(s.from) : `${s.from}-${s.to}`);
    navigate(`/share?${q.toString()}`);
  };

  return (
    <div className="min-h-screen bg-[#f6f1e6]">
      {/* PLCC Bible header: back to chats, title, languages. */}
      <header className="sticky top-0 z-20 bg-gradient-to-b from-[#12241c] to-[#1d372c] text-[#fbf7ee] shadow-[0_8px_20px_rgba(18,36,28,0.25)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            onClick={() => navigate('/community/chat')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/25 bg-white/10"
            aria-label="Back to chats"
          >
            <ChevronLeft size={22} aria-hidden />
          </button>
          <p className="flex min-w-0 flex-1 items-center gap-2 font-display text-[20px] font-bold">
            <BookOpen size={20} className="shrink-0 text-[#f3d27a]" aria-hidden /> Bible
          </p>
          <span className="shrink-0 rounded-full border border-[#d9b45e]/50 px-3 py-1 text-[12px] font-semibold text-[#f3d27a]">English and Luganda</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-3 pb-28 pt-3" aria-label="Bible">
        <div className="mb-3 overflow-hidden rounded-[22px] bg-[#12241c] shadow-[0_10px_30px_rgba(18,36,28,0.25)]">
          <picture>
            <source media="(min-width: 640px)" srcSet="/plcc-bible-banner-wide.webp" />
            <img src="/plcc-bible-banner.webp" alt="PLCC Bible: Read, Study, Reflect, Share" width={1080} height={360} className="block h-auto w-full" />
          </picture>
        </div>
        <div className="pr-bible !overflow-visible rounded-[22px] border border-[#ece3cf] !p-4 shadow-[0_6px_20px_rgba(29,55,44,0.06)] sm:!p-6">
          <Suspense
            fallback={
              <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
                <Loader2 className="animate-spin" size={18} aria-hidden /> Opening the Bible…
              </p>
            }
          >
            <BibleReader actions={[{ label: 'Share to a chat', primary: true, onShare: shareToChat }]} />
          </Suspense>
        </div>
      </main>
    </div>
  );
};

export default BiblePage;
