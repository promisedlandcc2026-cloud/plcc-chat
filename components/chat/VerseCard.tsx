import React from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { SharedVerse } from '../../lib/verseShare';

/** A Bible verse shared from the church Bible reader, shown as a card. */
export const VerseCard: React.FC<{ verse: SharedVerse }> = ({ verse }) => (
  <figure className="mt-1 rounded-xl border border-[#E8DCC2] border-l-4 border-l-[#C9A35A] bg-[#FBF7EE] px-3.5 py-3 text-[#16251f]">
    <figcaption className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-[#8a6a2e]">
      <BookOpen size={14} aria-hidden /> {verse.ref} · {verse.translation}
    </figcaption>
    <blockquote className="mt-1.5 text-[16px] leading-relaxed" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
      “{verse.text}”
    </blockquote>
    <a
      href={verse.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 text-[14px] font-bold text-[#1d372c] underline underline-offset-2"
    >
      Open in the Bible <ExternalLink size={14} aria-hidden />
    </a>
  </figure>
);
