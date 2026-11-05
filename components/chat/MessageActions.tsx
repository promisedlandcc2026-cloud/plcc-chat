import React, { useState } from 'react';
import { Portal } from './Portal';
import { CheckCircle2, Copy, CornerUpLeft, Flag, Loader2, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react';
import type { CommunityChatMessage } from '../../lib/communityChatTypes';
import type { ChatReportReason } from '../../lib/communityChatClient';
import { CHAT_REACTIONS } from '../../lib/chatMessageUtils';

const REPORT_REASONS: Array<{ id: ChatReportReason; label: string }> = [
  { id: 'inappropriate', label: 'Inappropriate or offensive' },
  { id: 'harassment', label: 'Bullying or harassment' },
  { id: 'safety', label: 'I’m worried about someone’s safety' },
  { id: 'spam', label: 'Spam or a scam' },
  { id: 'other', label: 'Something else' },
];

/** Pick a reason, add an optional note, send to church leaders. */
const ReportForm: React.FC<{
  authorName: string;
  onCancel: () => void;
  onDone: () => void;
  onReport: (reason: ChatReportReason, note: string) => Promise<void>;
}> = ({ authorName, onCancel, onDone, onReport }) => {
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="px-5 py-6 text-center space-y-3">
        <CheckCircle2 size={36} className="mx-auto text-emerald-600" aria-hidden />
        <p className="font-bold text-[#1A1A1A]">Thank you for telling us</p>
        <p className="text-sm text-gray-600">
          A church leader will review this message. {authorName} won’t be told who reported it.
        </p>
        <button type="button" onClick={onDone} className="w-full min-h-[48px] rounded-2xl bg-burgundy text-white font-bold">
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      className="px-5 pb-2 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason || busy) return;
        setBusy(true);
        setError(null);
        try {
          await onReport(reason, note);
          setSent(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not send that report.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="space-y-1">
        <legend className="text-sm font-bold text-[#1A1A1A] mb-1">What’s wrong with this message?</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r.id} className="flex items-center gap-3 min-h-[44px] rounded-xl px-2 active:bg-gray-50 cursor-pointer">
            <input
              type="radio"
              name="report-reason"
              value={r.id}
              checked={reason === r.id}
              onChange={() => setReason(r.id)}
              className="h-5 w-5 accent-burgundy"
            />
            <span className="text-[15px] text-[#1A1A1A]">{r.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="text-sm font-bold text-[#1A1A1A]">Anything else? (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          rows={3}
          className="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
        />
      </label>
      {reason === 'safety' ? (
        <p className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          If someone is in danger right now, call 911 first.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-burgundy" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" onClick={onCancel} className="min-h-[48px] rounded-2xl border border-gray-200 font-bold">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!reason || busy}
          className="min-h-[48px] rounded-2xl bg-burgundy text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="animate-spin" size={18} aria-hidden /> : null}
          Send report
        </button>
      </div>
    </form>
  );
};

/** Bottom sheet (phone) / centered card (desktop): react, reply, copy, edit, delete, report. */
export const MessageActions: React.FC<{
  message: CommunityChatMessage;
  selfId: string;
  canEdit: boolean;
  canDelete: boolean;
  /** Room leaders (or either person in a DM) can pin. */
  canPin?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onReport?: (reason: ChatReportReason, note: string) => Promise<void>;
}> = ({ message, selfId, canEdit, canDelete, canPin, isPinned, onTogglePin, onClose, onReact, onReply, onEdit, onDelete, onReport }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const canReport = Boolean(onReport) && message.author.id !== selfId;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const myEmojis = new Set((message.reactions || []).filter((r) => r.userIds.includes(selfId)).map((r) => r.emoji));
  const hasText = Boolean(message.content.trim());

  const row = 'w-full min-h-[56px] flex items-center gap-4 px-5 text-base font-semibold text-[#1A1A1A] active:bg-gray-50';

  return (
    <Portal>
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-[500px] lg:max-w-[420px] max-h-[90dvh] bg-white rounded-t-3xl lg:rounded-3xl shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Message options"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <p className="text-sm text-gray-500 truncate pr-3">
            {reporting
              ? `Report a message from ${message.author.name}`
              : message.author.id === selfId
                ? 'Your message'
                : message.author.name}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {reporting && onReport ? (
          <ReportForm
            authorName={message.author.name}
            onCancel={() => setReporting(false)}
            onDone={onClose}
            onReport={onReport}
          />
        ) : (
        <>
        <div className="px-3 pb-3 grid grid-cols-8 gap-1" role="group" aria-label="React">
          {CHAT_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(e);
                onClose();
              }}
              className={`aspect-square rounded-2xl text-2xl flex items-center justify-center ${
                myEmojis.has(e) ? 'bg-gold/30 ring-2 ring-gold' : 'bg-gray-50 active:bg-gold/20'
              }`}
              aria-label={`React ${e}`}
              aria-pressed={myEmojis.has(e)}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="border-t border-gray-100">
          <button
            type="button"
            className={row}
            onClick={() => {
              onReply();
              onClose();
            }}
          >
            <CornerUpLeft size={20} className="text-burgundy" aria-hidden />
            Reply
          </button>
          {hasText ? (
            <button
              type="button"
              className={row}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message.content);
                  setCopied(true);
                  window.setTimeout(onClose, 600);
                } catch {
                  onClose();
                }
              }}
            >
              <Copy size={20} className="text-burgundy" aria-hidden />
              {copied ? 'Copied' : 'Copy text'}
            </button>
          ) : null}
          {canPin && onTogglePin ? (
            <button
              type="button"
              className={row}
              onClick={() => {
                onTogglePin();
                onClose();
              }}
            >
              {isPinned ? (
                <PinOff size={20} className="text-burgundy" aria-hidden />
              ) : (
                <Pin size={20} className="text-burgundy" aria-hidden />
              )}
              {isPinned ? 'Unpin' : 'Pin to top'}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={row}
              onClick={() => {
                onEdit();
                onClose();
              }}
            >
              <Pencil size={20} className="text-burgundy" aria-hidden />
              Edit
            </button>
          ) : null}
          {canDelete ? (
            confirmDelete ? (
              <div className="px-5 py-3 space-y-2">
                <p className="text-sm text-gray-600">Remove this message for everyone?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[48px] rounded-2xl border border-gray-200 font-bold"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onDelete();
                        onClose();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="min-h-[48px] rounded-2xl bg-red-700 text-white font-bold disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className={`${row} text-red-700`} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={20} aria-hidden />
                Delete for everyone
              </button>
            )
          ) : null}
          {canReport ? (
            <button type="button" className={`${row} text-gray-600`} onClick={() => setReporting(true)}>
              <Flag size={20} aria-hidden />
              Report message
            </button>
          ) : null}
        </div>
        </>
        )}
      </div>
    </div>
    </Portal>
  );
};
