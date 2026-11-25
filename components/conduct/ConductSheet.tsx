import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldBan, X } from 'lucide-react';
import {
  WARN_REASONS,
  blockMember,
  fetchConductStatus,
  warnMember,
  type ConductStatus,
  type ConductTarget,
} from '../../lib/memberConduct';

/**
 * Moderator sheet: Warn first; "Block & remove" unlocks once they've been warned.
 * Same in Ka Link and Tribes (calls, chat messages, Tribes posts).
 */
export const ConductSheet: React.FC<{
  target: ConductTarget;
  onClose: () => void;
  onDone?: (status: ConductStatus, action: 'warn' | 'block') => void;
}> = ({ target, onClose, onDone }) => {
  const [status, setStatus] = useState<ConductStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'warn' | 'block' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>(WARN_REASONS[0]);
  const [other, setOther] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchConductStatus(target.userId, target.channelId)
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not check this member.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [target.userId, target.channelId]);

  const why = (other.trim() || reason).slice(0, 200);
  const first = target.name.split(/\s+/)[0] || target.name;

  const run = async (action: 'warn' | 'block') => {
    if (action === 'block' && !window.confirm(`Block ${target.name}? They'll be removed now and can't join calls, chat or post until a pastor or admin unblocks them.`)) return;
    setBusy(action);
    setError(null);
    try {
      const next = action === 'warn' ? await warnMember(target, why) : await blockMember(target, why);
      setStatus(next);
      setDone(action === 'warn' ? `${first} has been warned. If they keep going, you can block them.` : `${target.name} is blocked and has been removed.`);
      onDone?.(next, action);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[600] flex items-end sm:items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Warn or block ${target.name}`}
        className="w-full max-w-md rounded-3xl bg-white text-[#1A1A1A] p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="conduct-sheet"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold truncate">{target.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-black/5 flex items-center justify-center">
            <X size={20} aria-hidden />
          </button>
        </div>

        {loading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <Loader2 size={16} className="animate-spin" /> Checking…
          </p>
        ) : status?.blocked ? (
          <p className="mt-3 rounded-2xl bg-red-50 text-red-800 px-4 py-3 text-sm font-semibold">
            Already blocked. A pastor or admin can unblock them in Canaan → Blocked members.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-600">
              {status?.warnedAt
                ? `Warned already${status.warnReason ? ` ("${status.warnReason}")` : ''}. If they keep going, block them.`
                : 'Give a warning first. They see it straight away and must tap "I understand".'}
            </p>

            <fieldset className="mt-4">
              <legend className="text-sm font-bold">Reason</legend>
              <div className="mt-2 grid gap-2">
                {WARN_REASONS.map((r) => (
                  <label
                    key={r}
                    className={`flex items-center gap-3 min-h-[48px] rounded-2xl border px-4 text-sm font-semibold cursor-pointer ${
                      reason === r && !other.trim() ? 'border-amber-500 bg-amber-50' : 'border-black/10'
                    }`}
                  >
                    <input type="radio" name="conduct-reason" checked={reason === r && !other.trim()} onChange={() => { setReason(r); setOther(''); }} />
                    {r}
                  </label>
                ))}
                <input
                  type="text"
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  maxLength={200}
                  placeholder="Or type your own reason"
                  className="min-h-[48px] rounded-2xl border border-black/10 px-4 text-sm"
                />
              </div>
            </fieldset>

            {error ? (
              <p className="mt-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">
                {error}
              </p>
            ) : null}
            {done ? (
              <p className="mt-3 rounded-xl bg-emerald-50 text-emerald-800 text-sm px-3 py-2 font-semibold" role="status">
                {done}
              </p>
            ) : null}

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => void run('warn')}
                disabled={busy !== null}
                className="min-h-[52px] rounded-2xl bg-amber-500 text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"
                data-testid="conduct-warn"
              >
                {busy === 'warn' ? <Loader2 size={18} className="animate-spin" /> : <AlertTriangle size={18} />}
                {status?.warnedAt ? 'Warn again' : 'Give a warning'}
              </button>
              <button
                type="button"
                onClick={() => void run('block')}
                disabled={busy !== null || !status?.warnedAt}
                className="min-h-[52px] rounded-2xl bg-red-600 text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-40"
                data-testid="conduct-block"
              >
                {busy === 'block' ? <Loader2 size={18} className="animate-spin" /> : <ShieldBan size={18} />}
                Block &amp; remove
              </button>
              {!status?.warnedAt ? <p className="text-xs text-gray-500 text-center">Block unlocks after a warning.</p> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** What the member sees when warned or blocked in a call (must tap to close). */
export const ConductNoticeModal: React.FC<{ kind: 'warn' | 'block'; reason?: string | null; onClose: () => void }> = ({ kind, reason, onClose }) => (
  <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/60 p-4">
    <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-3xl bg-white text-[#1A1A1A] p-6 text-center shadow-2xl" data-testid="conduct-notice">
      {kind === 'warn' ? (
        <AlertTriangle size={40} className="mx-auto text-amber-500" aria-hidden />
      ) : (
        <ShieldBan size={40} className="mx-auto text-red-600" aria-hidden />
      )}
      <h2 className="mt-3 text-xl font-extrabold">{kind === 'warn' ? 'A warning from the moderators' : 'You have been blocked'}</h2>
      <p className="mt-2 text-base text-gray-700">
        {kind === 'warn'
          ? 'Please keep this call respectful. If it continues, you will be removed and blocked.'
          : 'Church leaders blocked your account from calls, chat and posts. Please speak to a pastor to have it lifted.'}
      </p>
      {reason ? <p className="mt-2 text-sm font-semibold text-gray-800">Reason: {reason}</p> : null}
      <button type="button" onClick={onClose} className="mt-5 w-full min-h-[52px] rounded-2xl bg-[#1A1A1A] text-white text-base font-extrabold">
        I understand
      </button>
    </div>
  </div>
);

/** A moderator asked me to unmute (LiveKit never switches on someone's mic for them). */
/** Nov 25 2026: the host's friendly "please mute your mic" reminder. Nothing is forced. */
export const AskMuteCard: React.FC<{ by?: string | null; onMute: () => void; onClose: () => void }> = ({ by, onMute, onClose }) => (
  <div
    className="fixed left-1/2 -translate-x-1/2 bottom-[max(6rem,calc(env(safe-area-inset-bottom)+6rem))] z-[700] w-[calc(100%-1.5rem)] max-w-[420px] rounded-2xl bg-[#12231c] text-white shadow-2xl border border-[#C9A35A]/50 p-4"
    role="alertdialog"
    aria-label="Please mute your mic"
    data-testid="ask-mute"
  >
    <p className="font-bold">Please mute your mic</p>
    <p className="mt-1 text-sm text-white/75">
      {by ? `${by} asked everyone with an open mic to mute.` : 'The moderator asked everyone with an open mic to mute.'} You can unmute again when it&apos;s your turn to speak.
    </p>
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onMute}
        className="min-h-[44px] px-5 rounded-full bg-[#C9A35A] text-[#12231c] font-black active:opacity-80"
      >
        Mute my mic
      </button>
      <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-full text-white/75 font-bold active:bg-white/10">
        Not now
      </button>
    </div>
  </div>
);

export const AskUnmuteCard: React.FC<{ onUnmute: () => void; onClose: () => void }> = ({ onUnmute, onClose }) => (
  <div
    className="fixed left-1/2 -translate-x-1/2 bottom-[max(6rem,calc(env(safe-area-inset-bottom)+6rem))] z-[700] w-[calc(100%-1.5rem)] max-w-[420px] rounded-2xl bg-[#12231c] text-white shadow-2xl border border-white/10 p-4"
    role="alertdialog"
    aria-label="A moderator asked you to unmute"
    data-testid="ask-unmute"
  >
    <p className="font-bold">A moderator asked you to unmute</p>
    <p className="mt-1 text-sm text-white/75">Your mic is unlocked. Tap Unmute when you are ready to speak.</p>
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onUnmute}
        className="min-h-[44px] px-5 rounded-full bg-[#C9A35A] text-[#12231c] font-black active:opacity-80"
      >
        Unmute
      </button>
      <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-full text-white/75 font-bold active:bg-white/10">
        Not now
      </button>
    </div>
  </div>
);
