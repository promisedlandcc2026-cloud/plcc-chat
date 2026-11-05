import React, { useState } from 'react';
import { BarChart3, Check, Loader2, Lock } from 'lucide-react';
import type { ChatPoll } from '../../lib/communityChatTypes';

/**
 * A poll inside a chat bubble. Big tap targets: tap a choice to vote, tap it
 * again to take the vote back. Bars and counts show once you've voted (or the
 * poll is closed), so early votes don't sway the rest.
 */
export const PollCard: React.FC<{
  poll: ChatPoll;
  mine: boolean;
  /** The poll's author or a room leader. */
  canClose: boolean;
  onVote: (poll: ChatPoll, optionIds: string[]) => Promise<void>;
  onClose: (poll: ChatPoll) => Promise<void>;
}> = ({ poll, mine, canClose, onVote, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [showVoters, setShowVoters] = useState(false);
  const voted = poll.myVotes.length > 0;
  const showResults = voted || poll.closed;
  const top = Math.max(1, ...poll.options.map((o) => o.count));

  const tap = async (optionId: string) => {
    if (poll.closed || busy) return;
    const has = poll.myVotes.includes(optionId);
    const next = poll.multi
      ? has
        ? poll.myVotes.filter((v) => v !== optionId)
        : [...poll.myVotes, optionId]
      : has
        ? []
        : [optionId];
    setBusy(optionId);
    try {
      await onVote(poll, next);
    } finally {
      setBusy(null);
    }
  };

  const ink = mine ? 'text-white' : 'text-[#1A1A1A]';
  const soft = mine ? 'text-white/75' : 'text-gray-500';

  return (
    <div className="min-w-[230px] sm:min-w-[300px]" onTouchStart={(e) => e.stopPropagation()}>
      <p className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${mine ? 'text-gold-light' : 'text-burgundy'}`}>
        <BarChart3 size={14} aria-hidden /> Poll{poll.closed ? ' · Closed' : ''}
      </p>
      <p className={`mt-1 text-[17px] font-bold leading-snug ${ink}`}>{poll.question}</p>
      <p className={`mt-0.5 text-xs ${soft}`}>
        {poll.closed ? 'Voting has ended' : poll.multi ? 'Pick one or more' : 'Pick one'}
        {poll.anonymous ? ' · Votes are private' : ''}
      </p>

      <ul className="mt-3 space-y-2" role="list">
        {poll.options.map((o) => {
          const picked = poll.myVotes.includes(o.id);
          const pct = poll.totalVoters ? Math.round((o.count / poll.totalVoters) * 100) : 0;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => void tap(o.id)}
                disabled={poll.closed || Boolean(busy)}
                aria-pressed={picked}
                className={`relative w-full min-h-[52px] overflow-hidden rounded-xl border-2 text-left px-3 py-2 flex items-center gap-3 transition-colors disabled:cursor-default ${
                  mine
                    ? picked ? 'border-gold bg-white/10' : 'border-white/30 bg-white/5'
                    : picked ? 'border-burgundy bg-burgundy/5' : 'border-gray-200 bg-white'
                }`}
              >
                {showResults ? (
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 left-0 ${mine ? 'bg-gold/30' : 'bg-gold/25'} transition-[width] duration-500`}
                    style={{ width: `${Math.round((o.count / top) * 100)}%` }}
                  />
                ) : null}
                <span
                  aria-hidden
                  className={`relative shrink-0 h-6 w-6 flex items-center justify-center border-2 ${poll.multi ? 'rounded-md' : 'rounded-full'} ${
                    picked
                      ? mine ? 'bg-gold border-gold text-burgundy' : 'bg-burgundy border-burgundy text-white'
                      : mine ? 'border-white/60' : 'border-gray-300'
                  }`}
                >
                  {busy === o.id ? <Loader2 size={14} className="animate-spin" /> : picked ? <Check size={15} strokeWidth={3} /> : null}
                </span>
                <span className={`relative flex-1 text-[15px] font-semibold ${ink}`}>{o.text}</span>
                {showResults ? (
                  <span className={`relative text-sm font-bold tabular-nums ${ink}`}>
                    {o.count} <span className={`font-medium ${soft}`}>({pct}%)</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${soft}`}>
        <span>
          {poll.totalVoters} {poll.totalVoters === 1 ? 'person' : 'people'} voted
          {!showResults ? ' · vote to see results' : ''}
        </span>
        {showResults && !poll.anonymous && poll.totalVoters > 0 ? (
          <button type="button" onClick={() => setShowVoters((v) => !v)} className="font-bold underline underline-offset-2 min-h-[32px]">
            {showVoters ? 'Hide names' : 'See who voted'}
          </button>
        ) : null}
        {canClose && !poll.closed ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Close this poll? No one will be able to vote after this.')) void onClose(poll);
            }}
            className="inline-flex items-center gap-1 font-bold underline underline-offset-2 min-h-[32px]"
          >
            <Lock size={12} aria-hidden /> Close poll
          </button>
        ) : null}
      </div>

      {showVoters && showResults && !poll.anonymous ? (
        <div className={`mt-2 space-y-1.5 text-xs ${ink}`}>
          {poll.options
            .filter((o) => o.voters.length)
            .map((o) => (
              <p key={o.id}>
                <span className="font-bold">{o.text}:</span> {o.voters.join(', ')}
                {o.count > o.voters.length ? ` and ${o.count - o.voters.length} more` : ''}
              </p>
            ))}
        </div>
      ) : null}
    </div>
  );
};
