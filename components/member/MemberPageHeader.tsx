/**
 * Design kit — page header for member screens.
 * Back link, optional eyebrow, serif page title (the one place Playfair is used
 * in the UI), optional subtitle and an optional action on the right.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

type MemberPageHeaderProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** null hides the back link (top-level screen). */
  backTo?: string | null;
  backLabel?: string;
  /** e.g. a Refresh or Add button, shown next to the back link */
  action?: React.ReactNode;
};

export const MemberPageHeader: React.FC<MemberPageHeaderProps> = ({
  title,
  eyebrow,
  subtitle,
  backTo = '/',
  backLabel = 'Home',
  action,
}) => (
  <header className="mb-6">
    <div className="flex items-center justify-between gap-3 -ml-2">
      {backTo === null ? (
        <span />
      ) : (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 rounded-xl pl-1 pr-3 text-burgundy text-[15px] font-semibold min-h-[44px] active:bg-burgundy/5"
        >
          <ChevronLeft size={22} aria-hidden />
          {backLabel}
        </Link>
      )}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    {eyebrow ? (
      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-gold-ink">{eyebrow}</p>
    ) : null}
    <h1 className={`${eyebrow ? 'mt-1' : 'mt-3'} font-display text-[30px] leading-tight font-bold text-ink`}>
      {title}
    </h1>
    {subtitle ? <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">{subtitle}</p> : null}
  </header>
);
