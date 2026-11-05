import React from 'react';

type HuddleLiveDotProps = {
  /** Compact pulsing emerald mark — matches Vault channel LIVE. */
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
};

export const HuddleLiveDot: React.FC<HuddleLiveDotProps> = ({
  size = 'sm',
  className = '',
  label = 'Live huddle',
}) => {
  const dim = size === 'md' ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5';
  const labelled = Boolean(label);
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      role={labelled ? 'status' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      <span className={`rounded-full bg-emerald-500 animate-pulse ${dim}`} aria-hidden />
    </span>
  );
};

export const HuddleLiveBadge: React.FC<{ count?: number }> = ({ count = 0 }) => {
  const n = Number(count) > 0 ? Math.floor(Number(count)) : 0;
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5"
      aria-label={n > 0 ? `Live huddle, ${n} in room` : 'Live huddle'}
    >
      <HuddleLiveDot label="" />
      {n > 0 ? `LIVE · ${n}` : 'LIVE'}
    </span>
  );
};
