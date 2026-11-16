import React, { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { SharedVerse } from '../../lib/verseShare';

/** A Bible verse shared from the church Bible reader, shown as a card. Long passages fold to a few lines. */
export const VerseCard: React.FC<{ verse: SharedVerse; lines?: number }> = ({ verse, lines = 6 }) => {
  const [open, setOpen] = useState(false);
  const long = verse.text.length > lines * 55;
  return (
    <figure className="mt-1 rounded-xl border border-[#E8DCC2] border-l-4 border-l-[#C9A35A] bg-[#FBF7EE] px-3.5 py-3 text-[#16251f]">
      <figcaption className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-[#8a6a2e]">
        <BookOpen size={14} aria-hidden /> {verse.ref} · {verse.translation}
      </figcaption>
      <blockquote
        className="mt-1.5 text-[16px] leading-relaxed"
        style={{
          fontFamily: "'Fraunces', Georgia, serif",
          ...(long && !open ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' } : {}),
        }}
      >
        “{verse.text}”
      </blockquote>
      <div className="mt-2 flex flex-wrap items-center gap-x-4">
        {long ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            aria-expanded={open}
            className="min-h-[36px] text-[14px] font-bold text-[#8a6a2e]"
          >
            {open ? 'Show less' : 'Show all'}
          </button>
        ) : null}
        <a
          href={verse.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-h-[36px] items-center gap-1.5 text-[14px] font-bold text-[#1d372c] underline underline-offset-2"
        >
          Open in the Bible <ExternalLink size={14} aria-hidden />
        </a>
      </div>
    </figure>
  );
};
