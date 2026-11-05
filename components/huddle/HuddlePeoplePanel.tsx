import React from 'react';
import { Hand, Mic, MicOff, Users, Video, VideoOff, X } from 'lucide-react';
import {
  leftAgoLabel,
  type HuddleRosterEntry,
} from '../../lib/huddlePresence';

type Props = {
  /** When false and variant=sheet, render nothing. Embedded always renders body. */
  open?: boolean;
  onClose?: () => void;
  roster: HuddleRosterEntry[];
  title?: string;
  /** sheet = fullscreen overlay (legacy); embedded = in-tab body */
  variant?: 'sheet' | 'embedded';
  /** Optional invite / extra actions under Attendance (Family) */
  footer?: React.ReactNode;
};

export const HuddlePeoplePanel: React.FC<Props> = ({
  open = true,
  onClose,
  roster,
  title = 'People in this huddle',
  variant = 'sheet',
  footer,
}) => {
  const inRoom = roster.filter((e) => e.status === 'in');
  const left = roster.filter((e) => e.status === 'left');
  const now = Date.now();

  const body = (
    <div
      className={`flex flex-col min-h-0 ${variant === 'embedded' ? 'h-full' : 'flex-1'}`}
      data-testid="huddle-attendance-panel"
    >
      {variant === 'embedded' ? (
        <div className="px-4 pt-1 pb-2 border-b border-white/10 shrink-0">
          <p className="text-xs font-black uppercase tracking-widest text-gold flex items-center gap-1.5">
            <Users size={14} aria-hidden /> Attendance
          </p>
          <p className="text-xs text-white/50 mt-0.5">
            {inRoom.length} in huddle
            {left.length ? ` · ${left.length} left this session` : ''}
          </p>
        </div>
      ) : null}

      <div
        className={`flex-1 overflow-y-auto px-4 py-3 space-y-5 min-h-0 ${
          variant === 'sheet' ? 'pb-[max(1rem,env(safe-area-inset-bottom))]' : ''
        }`}
      >
        <section>
          <p className="text-xs font-black uppercase tracking-widest text-gold mb-2">
            In huddle
          </p>
          {inRoom.length === 0 ? (
            <p className="text-xs text-white/40 py-2">No one is in the room right now.</p>
          ) : (
            <ul className="space-y-2">
              {inRoom.map((entry) => (
                <li
                  key={entry.identity}
                  className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 px-3 py-2.5"
                >
                  <span className="w-9 h-9 rounded-full bg-burgundy/80 flex items-center justify-center text-sm font-bold shrink-0">
                    {(entry.name[0] || 'M').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">
                      {entry.name}
                      {entry.isLocal ? ' (you)' : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-white/60">
                      {entry.micOn ? <Mic size={12} /> : <MicOff size={12} />}
                      {entry.camOn ? <Video size={12} /> : <VideoOff size={12} />}
                      {entry.handRaised ? (
                        <span className="inline-flex items-center gap-1 text-gold text-xs font-bold uppercase tracking-wide">
                          <Hand size={12} aria-hidden /> Hand raised
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {left.length > 0 ? (
          <section>
            <p className="text-xs font-black uppercase tracking-widest text-white/40 mb-2">
              Left this huddle
            </p>
            <ul className="space-y-2">
              {left.map((entry) => (
                <li
                  key={entry.identity}
                  className="flex items-center gap-3 rounded-2xl bg-white/[0.03] border border-white/5 px-3 py-2.5 opacity-80"
                >
                  <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold shrink-0 text-white/50">
                    {(entry.name[0] || 'M').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate text-white/70">{entry.name}</p>
                    <p className="text-xs text-white/40 font-medium mt-0.5">
                      {leftAgoLabel(entry.leftAt, now)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {footer ? <div className="pt-2 border-t border-white/10">{footer}</div> : null}
      </div>
    </div>
  );

  if (variant === 'embedded') return body;
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[450] flex flex-col justify-end sm:justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="bg-[#1a1216] text-white rounded-t-[28px] sm:rounded-[28px] sm:mx-auto w-full max-w-md max-h-[min(85vh,640px)] flex flex-col shadow-2xl border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <Users size={18} className="text-gold shrink-0" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{title}</h3>
              <p className="text-xs text-white/50 font-medium">
                {inRoom.length} in huddle
                {left.length ? ` · ${left.length} left` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-full bg-white/10 flex items-center justify-center shrink-0"
            aria-label="Close people list"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {body}
      </div>
    </div>
  );
};
