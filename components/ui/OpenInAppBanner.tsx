import React, { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { installedAppButInBrowser } from '../../lib/installPrompt';

const DISMISS_KEY = 'plcc_open_in_app_dismissed';

/**
 * Phase 5 #33 — one app, not two.
 *
 * Shown in the browser when the PLCC Ka Link app is already on this phone, so
 * members use one place for calls (a second copy causes echo and double audio;
 * LiveKit also closes the older copy). Phones don't let a website open the
 * home-screen app by itself, so we tell them where to tap. Hidden for the rest
 * of the visit once dismissed.
 */
export const OpenInAppBanner: React.FC = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* private mode */
    }
    void installedAppButInBrowser().then((yes) => {
      if (!cancelled && yes) setShow(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode */
    }
  };

  return (
    <div
      role="status"
      data-testid="open-in-app-banner"
      className="sticky top-0 z-[300] flex items-center gap-3 bg-[#0e1512] text-white px-4 py-2.5 text-sm"
    >
      <Smartphone size={18} className="shrink-0 text-[#f1d58f]" aria-hidden />
      <p className="flex-1 min-w-0 leading-snug">
        <strong>You have the PLCC Ka Link app.</strong> Open it from your home screen so you're only in one place
        during Ka Link calls.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full hover:bg-white/10"
        aria-label="Dismiss"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );
};
