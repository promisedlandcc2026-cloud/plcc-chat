import React from 'react';
import { BellRing, BookOpen, Hand, Loader2, Lock, Mic, MicOff, ShieldBan, Unlock, UserMinus, X } from 'lucide-react';
import type { HuddleModerateAction } from '../../lib/communityChatClient';

/**
 * Ka Link Phase 2 moderator tools (Nov 2026):
 *  #5 mute / unmute anyone   #7 lower all hands   #8 lock mics, allow to speak
 *  #11 Bible readers          #16 remove · warn, then block (lasting)
 */

export type ModeratorTarget = {
  identity: string;
  name: string;
  micOn: boolean;
  handRaised: boolean;
  moderator: boolean;
  reader: boolean;
};

export function ModeratorRoomBar({
  micLock,
  handsCount,
  busy,
  onToggleLock,
  onLowerAll,
  onMuteAll,
  onUnmuteAll,
  onRemindMute,
}: {
  micLock: boolean;
  handsCount: number;
  busy: boolean;
  onToggleLock: () => void;
  onLowerAll: () => void;
  onMuteAll: () => void;
  onUnmuteAll: () => void;
  /** Only for the moderator who opened the Ka Link (host). */
  onRemindMute?: () => void;
}) {
  return (
    <div className="pr-mod-bar" role="group" aria-label="Moderator controls" data-testid="huddle-moderator-bar">
      <button
        type="button"
        onClick={onToggleLock}
        disabled={busy}
        className={`pr-tool ${micLock ? 'is-locked' : ''}`}
        aria-pressed={micLock}
      >
        {micLock ? <Unlock size={16} aria-hidden /> : <Lock size={16} aria-hidden />}
        {micLock ? 'Unlock mics' : 'Lock mics'}
      </button>
      <button type="button" onClick={onLowerAll} disabled={busy || handsCount === 0} className="pr-tool">
        <Hand size={16} aria-hidden /> Lower all hands{handsCount ? ` (${handsCount})` : ''}
      </button>
      {onRemindMute ? (
        <button type="button" onClick={onRemindMute} disabled={busy} className="pr-tool is-gold" data-testid="remind-mute-all">
          <BellRing size={16} aria-hidden /> Remind all to mute
        </button>
      ) : null}
      <button type="button" onClick={onMuteAll} disabled={busy} className="pr-tool">
        <MicOff size={16} aria-hidden /> Mute all
      </button>
      <button type="button" onClick={onUnmuteAll} disabled={busy || micLock} className="pr-tool">
        <Mic size={16} aria-hidden /> Ask all to unmute
      </button>
      {micLock ? (
        <p className="pr-mod-hint">Mics are locked. Members raise a hand; tap a name to let them speak.</p>
      ) : null}
    </div>
  );
}

/** 'conduct' opens the Warn / Block sheet instead of a call action. */
export type ModeratorSheetAction = HuddleModerateAction | 'conduct';

type SheetAction = { action: ModeratorSheetAction; label: string; Icon: React.ElementType; danger?: boolean; confirm?: string };

export function moderatorActionsFor(target: ModeratorTarget, micLock: boolean, isHost = false): SheetAction[] {
  const out: SheetAction[] = [];
  // Nov 25 2026: the host can ask (not force) someone with an open mic to mute.
  if (isHost && target.micOn && !target.moderator) {
    out.push({ action: 'ask-mute', label: 'Ask them to mute', Icon: BellRing });
  }
  if (micLock && !target.moderator && !target.reader) {
    out.push({ action: 'allow-mic', label: 'Let them speak', Icon: Mic });
    out.push({ action: 'revoke-mic', label: 'Done speaking (take mic back)', Icon: MicOff });
  } else if (target.handRaised && !target.micOn) {
    // Mics unlocked (or the lock state didn't load): asks them to unmute and lowers their hand.
    out.push({ action: 'allow-mic', label: 'Let them speak', Icon: Mic });
  }
  out.push(
    target.micOn
      ? { action: 'mute', label: 'Mute their mic', Icon: MicOff }
      : { action: 'unmute', label: 'Unmute their mic', Icon: Mic }
  );
  if (target.handRaised) out.push({ action: 'lower-hand', label: 'Lower their hand', Icon: Hand });
  if (!target.moderator) {
    out.push(
      target.reader
        ? { action: 'reader-remove', label: 'Stop being a Bible reader', Icon: BookOpen }
        : { action: 'reader-add', label: 'Make Bible reader (can unmute anytime)', Icon: BookOpen }
    );
    out.push({
      action: 'remove',
      label: 'Remove from Ka Link',
      Icon: UserMinus,
      danger: true,
      confirm: `Remove ${target.name} from this Ka Link? They can join again.`,
    });
    // Lasting block (calls, chat, Tribes posts) — warn first, then block (Nov 19).
    out.push({
      action: 'conduct',
      label: 'Warn or block…',
      Icon: ShieldBan,
      danger: true,
    });
  }
  return out;
}

export function PersonActionsSheet({
  target,
  micLock,
  isHost = false,
  busy,
  error,
  onAction,
  onClose,
}: {
  target: ModeratorTarget;
  micLock: boolean;
  isHost?: boolean;
  busy: boolean;
  error: string | null;
  onAction: (action: ModeratorSheetAction) => void;
  onClose: () => void;
}) {
  const actions = moderatorActionsFor(target, micLock, isHost);
  return (
    <div className="pr-sheet-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Moderate ${target.name}`}
        className="pr-sheet"
        onClick={(e) => e.stopPropagation()}
        data-testid="huddle-person-actions"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold truncate">{target.name}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] rounded-full hover:bg-black/5 flex items-center justify-center"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {[target.moderator ? 'Moderator' : null, target.reader ? 'Bible reader' : null, target.handRaised ? 'Hand raised' : null, target.micOn ? 'Mic on' : 'Muted']
            .filter(Boolean)
            .join(' · ')}
        </p>
        {error ? (
          <p className="mt-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {actions.map(({ action, label, Icon, danger, confirm }) => (
            <li key={action}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm && !window.confirm(confirm)) return;
                  onAction(action);
                }}
                className={`w-full min-h-[48px] rounded-2xl px-4 flex items-center gap-3 text-sm font-bold text-left border ${
                  danger ? 'border-red-200 text-red-700 bg-red-50' : 'border-black/10 bg-white'
                } disabled:opacity-60`}
              >
                {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Icon size={18} aria-hidden />}
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
