import React from 'react';
import { Hand, Mic } from 'lucide-react';

export type HuddleHandEntry = {
  identity: string;
  name: string;
  isLocal: boolean;
  /** Their fixed hand number for this Ka Link. */
  number?: number;
};

type Props = {
  /** In the order hands went up (first come, first served). */
  raised: HuddleHandEntry[];
  handRaised: boolean;
  onToggleHand: () => void;
  /** Moderators: let someone speak, lower one hand, or lower all. */
  canModerate?: boolean;
  busy?: boolean;
  onLetSpeak?: (identity: string) => void;
  onLowerHand?: (identity: string) => void;
  onLowerAll?: () => void;
};

export const HuddleHandsPanel: React.FC<Props> = ({
  raised,
  handRaised,
  onToggleHand,
  canModerate = false,
  busy = false,
  onLetSpeak,
  onLowerHand,
  onLowerAll,
}) => {
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="huddle-hands-panel">
      <div className="px-4 pt-1 pb-3 border-b border-white/10 shrink-0">
        <p className="text-xs font-black uppercase tracking-widest text-gold flex items-center gap-1.5">
          <Hand size={14} aria-hidden /> Hands
        </p>
        <p className="text-xs text-white/50 mt-1">
          {raised.length === 0
            ? 'No hands raised right now.'
            : `${raised.length} raised — in the order they went up.`}
        </p>
        {canModerate && raised.length > 0 && onLowerAll ? (
          <button
            type="button"
            onClick={onLowerAll}
            disabled={busy}
            className="mt-2 min-h-[40px] px-4 rounded-xl bg-white/10 text-white text-xs font-bold disabled:opacity-60"
          >
            Lower all hands
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {raised.length === 0 ? (
          <p className="text-sm text-white/40 text-center py-8">
            Tap Raise hand when you want to speak.
          </p>
        ) : (
          <ol className="space-y-2">
            {raised.map((entry, index) => (
              <li
                key={entry.identity}
                className="flex items-center gap-3 rounded-2xl bg-gold/10 border border-gold/30 px-3 py-2.5"
              >
                <span className="w-8 h-8 rounded-full bg-gold text-burgundy flex items-center justify-center text-xs font-black shrink-0">
                  {entry.number ?? index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">
                    {entry.name}
                    {entry.isLocal ? ' (you)' : ''}
                  </p>
                </div>
                {canModerate && !entry.isLocal && onLetSpeak ? (
                  <button
                    type="button"
                    onClick={() => onLetSpeak(entry.identity)}
                    disabled={busy}
                    className="min-h-[36px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-60"
                  >
                    <Mic size={14} aria-hidden /> Let speak
                  </button>
                ) : null}
                {canModerate && !entry.isLocal && onLowerHand ? (
                  <button
                    type="button"
                    onClick={() => onLowerHand(entry.identity)}
                    disabled={busy}
                    className="min-h-[36px] px-3 rounded-xl bg-white/10 text-white text-xs font-bold disabled:opacity-60"
                    aria-label={`Lower ${entry.name}'s hand`}
                  >
                    Lower
                  </button>
                ) : (
                  <Hand size={16} className="text-gold shrink-0" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="px-4 pt-2 pb-1 shrink-0 border-t border-white/10">
        <button
          type="button"
          onClick={onToggleHand}
          className={`w-full min-h-[48px] rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
            handRaised
              ? 'bg-gold text-burgundy'
              : 'bg-burgundy text-white'
          }`}
          aria-pressed={handRaised}
        >
          <Hand size={18} aria-hidden />
          {handRaised ? 'Lower hand' : 'Raise hand'}
        </button>
      </div>
    </div>
  );
};
