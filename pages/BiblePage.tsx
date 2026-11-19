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
    <div className="pr-shell">
      <div className="pr-bible-sheet" role="main" aria-label="Bible">
        <div className="pr-bible-sheet-head">
          <button
            type="button"
            onClick={() => navigate('/community/chat')}
            className="pr-icon-btn"
            aria-label="Back to chats"
          >
            <ChevronLeft size={22} aria-hidden />
          </button>
          <p>
            <BookOpen size={18} aria-hidden /> Bible
          </p>
          <span className="pr-bible-sheet-sub">English and Luganda</span>
        </div>
        <div className="pr-bible pr-bible-sheet-body overflow-y-auto">
          <Suspense
            fallback={
              <p className="flex items-center gap-2 py-8 text-sm text-gray-300">
                <Loader2 className="animate-spin" size={18} aria-hidden /> Opening the Bible…
              </p>
            }
          >
            <BibleReader actions={[{ label: 'Share to a chat', primary: true, onShare: shareToChat }]} />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default BiblePage;
