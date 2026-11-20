/**
 * "A new version of APP is ready" with an Update button (and "Later"). Shows when a fix,
 * patch or upgrade has been published while the app is open. Important fixes can't be
 * snoozed. During a call it never reloads: "Update after the call" waits for the call to end.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import {
  UPDATE_CHECK_MS,
  fetchLatestVersion,
  hasUpdate,
  isSnoozed,
  reloadToNewVersion,
  snooze,
  type LatestVersion,
} from '../../lib/appUpdate';
import { isCallActive, updateWhenCallEnds } from '../../lib/staleBuild';

export const UpdateBanner: React.FC<{ appName: string; className?: string }> = ({ appName, className }) => {
  const [latest, setLatest] = useState<LatestVersion | null>(null);
  const [hidden, setHidden] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [updating, setUpdating] = useState(false);

  const check = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const v = await fetchLatestVersion();
    if (!hasUpdate(v)) return;
    setLatest(v);
    setHidden(Boolean(v && !v.critical && isSnoozed(v.id)));
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void check(), 15_000);
    const every = window.setInterval(() => void check(), UPDATE_CHECK_MS);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const onOnline = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [check]);

  if (!latest || hidden) return null;

  const update = () => {
    if (isCallActive()) {
      updateWhenCallEnds();
      setWaiting(true);
      return;
    }
    setUpdating(true);
    void reloadToNewVersion();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-banner"
      className={`fixed left-1/2 -translate-x-1/2 top-[max(env(safe-area-inset-top),0.5rem)] w-[calc(100%-1.5rem)] max-w-[460px] rounded-2xl bg-[#12231c] text-white shadow-2xl border border-white/10 p-3.5 ${className || 'z-[475]'}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#C9A35A]/25 text-[#E8D8B2]" aria-hidden>
          <Sparkles size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-snug">
            {latest.critical ? `Important fix for ${appName}` : `A new version of ${appName} is ready`}
          </p>
          <p className="mt-0.5 text-sm text-white/75 leading-snug">
            {waiting
              ? 'It will update by itself when your call ends.'
              : latest.notes || 'Fixes and improvements. Tap Update — it takes a few seconds.'}
          </p>
          {!waiting ? (
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={update}
                disabled={updating}
                className="min-h-[40px] px-4 inline-flex items-center gap-1.5 rounded-full bg-[#C9A35A] text-[#12231c] text-sm font-black active:opacity-80 disabled:opacity-60"
                data-testid="update-now"
              >
                <RefreshCw size={15} className={updating ? 'animate-spin' : ''} aria-hidden />
                {updating ? 'Updating…' : isCallActive() ? 'Update after the call' : 'Update'}
              </button>
              {!latest.critical ? (
                <button
                  type="button"
                  onClick={() => {
                    snooze(latest.id);
                    setHidden(true);
                  }}
                  className="min-h-[40px] px-3 rounded-full text-sm font-bold text-white/70 active:bg-white/10"
                >
                  Later
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {!latest.critical && !waiting ? (
          <button
            type="button"
            onClick={() => {
              snooze(latest.id);
              setHidden(true);
            }}
            className="-mr-1 -mt-1 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-white/60 active:bg-white/10"
            aria-label="Remind me later"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
};
