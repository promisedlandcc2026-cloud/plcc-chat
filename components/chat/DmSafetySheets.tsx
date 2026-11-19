import React, { useState } from 'react';
import { Ban, Flag, Loader2, X } from 'lucide-react';
import { Portal } from './Portal';
import { reportDm, setDmBlocked, type DmReportReason } from '../../lib/communityChatClient';

export type DmTarget = { id: string; title: string };

const SHEET =
  'w-full max-w-[500px] lg:max-w-[440px] max-h-[90dvh] overflow-y-auto bg-white rounded-t-3xl lg:rounded-3xl shadow-2xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]';

const REASONS: Array<[DmReportReason, string]> = [
  ['money', 'Asking for money, mobile money or a PIN'],
  ['impersonation', 'Pretending to be the Apostle, a pastor or a leader'],
  ['spam', 'Scam, fake link or spam'],
  ['harassment', 'Harassment, bullying or threats'],
  ['inappropriate', 'Inappropriate or sexual messages'],
  ['other', 'Something else'],
];

const Backdrop: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <Portal>
    <div className="fixed inset-0 z-[400] bg-black/40 flex items-end lg:items-center justify-center" onClick={onClose}>
      {children}
    </div>
  </Portal>
);

/** "Block Joy?" — confirm, with a shortcut to Block and report. */
export const DmBlockSheet: React.FC<{
  target: DmTarget;
  onClose: () => void;
  onBlocked: () => void;
  onReportInstead: () => void;
}> = ({ target, onClose, onBlocked, onReportInstead }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const block = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setDmBlocked(target.id, true);
      onBlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not block this person.');
      setBusy(false);
    }
  };
  return (
    <Backdrop onClose={() => !busy && onClose()}>
      <div className={SHEET} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="dm-block-title">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
          <Ban size={22} aria-hidden />
        </div>
        <h2 id="dm-block-title" className="text-lg font-bold text-[#1A1A1A]">
          Block {target.title}?
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          They won’t be able to send you private messages, and they aren’t told you blocked them. You can unblock any time.
        </p>
        {error ? <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p> : null}
        <div className="mt-5 grid gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void block()}
            className="w-full min-h-[52px] rounded-2xl bg-rose-600 text-white text-base font-bold inline-flex items-center justify-center gap-2 active:bg-rose-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Ban size={18} aria-hidden />}
            {busy ? 'Blocking…' : 'Block'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReportInstead}
            className="w-full min-h-[52px] rounded-2xl border border-rose-200 text-rose-700 text-base font-bold inline-flex items-center justify-center gap-2 active:bg-rose-50"
          >
            <Flag size={18} aria-hidden /> Block and report
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="w-full min-h-[52px] rounded-2xl bg-gray-100 text-[#1A1A1A] text-base font-bold active:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </Backdrop>
  );
};

/** Report a private conversation to church leaders (recent messages go with it). */
export const DmReportSheet: React.FC<{
  target: DmTarget;
  alreadyBlocked: boolean;
  onClose: () => void;
  onSent: (alsoBlocked: boolean) => void;
}> = ({ target, alreadyBlocked, onClose, onSent }) => {
  const [reason, setReason] = useState<DmReportReason | null>(null);
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(!alreadyBlocked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reportDm(target.id, reason, note, alsoBlock && !alreadyBlocked);
      onSent(alsoBlock && !alreadyBlocked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that report. Please try again.');
      setBusy(false);
    }
  };
  return (
    <Backdrop onClose={() => !busy && onClose()}>
      <div className={SHEET} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="dm-report-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="dm-report-title" className="text-lg font-bold text-[#1A1A1A]">
              Report {target.title}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Church leaders get your report with the recent messages from this chat. {target.title} isn’t told.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 rounded-full flex items-center justify-center text-gray-500"
            aria-label="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <fieldset className="mt-4">
          <legend className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2">What’s happening?</legend>
          <div className="grid gap-2">
            {REASONS.map(([value, text]) => (
              <label
                key={value}
                className={`flex items-center gap-3 min-h-[52px] px-4 rounded-2xl border cursor-pointer text-sm font-semibold ${
                  reason === value ? 'border-rose-400 bg-rose-50 text-rose-800' : 'border-gray-200 text-[#1A1A1A]'
                }`}
              >
                <input
                  type="radio"
                  name="dm-report-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                  className="accent-rose-600 w-4 h-4"
                />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block mt-4">
          <span className="text-xs font-black uppercase tracking-widest text-gray-500">Anything else? (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="e.g. They asked me to send 50,000 UGX by MTN."
            className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-base focus:outline-none focus:border-burgundy/50"
          />
        </label>
        {!alreadyBlocked ? (
          <label className="mt-3 flex items-center gap-3 min-h-[48px] cursor-pointer">
            <input
              type="checkbox"
              checked={alsoBlock}
              onChange={(e) => setAlsoBlock(e.target.checked)}
              className="accent-rose-600 w-5 h-5"
            />
            <span className="text-sm font-semibold text-[#1A1A1A]">Also block {target.title}</span>
          </label>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p> : null}
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            disabled={busy || !reason}
            onClick={() => void send()}
            className="w-full min-h-[52px] rounded-2xl bg-rose-600 text-white text-base font-bold inline-flex items-center justify-center gap-2 active:bg-rose-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Flag size={18} aria-hidden />}
            {busy ? 'Sending…' : 'Send report'}
          </button>
          <p className="text-xs text-gray-500 text-center">If someone is in danger, call a church leader right away.</p>
        </div>
      </div>
    </Backdrop>
  );
};
