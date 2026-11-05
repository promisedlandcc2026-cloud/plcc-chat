import { useEffect } from 'react';

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
  standalone?: boolean;
};

/**
 * iPhone home-screen apps (before iOS 18.4) accept a wake lock but don't honor
 * it, and older browsers have no Wake Lock API at all. There a tiny silent,
 * muted, looping inline video keeps the screen on (the long-standing
 * "NoSleep" approach). Files: /nosleep.mp4 and /nosleep.webm.
 */
export function needsVideoKeepAwake(nav: WakeLockNavigator = navigator as WakeLockNavigator): boolean {
  if (!nav.wakeLock?.request) return true;
  const ua = nav.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  if (!iOS) return false;
  const standalone =
    nav.standalone === true ||
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches);
  if (!standalone) return false;
  const m = /OS (\d+)_(\d+)/.exec(ua);
  const major = m ? Number(m[1]) : 0;
  const minor = m ? Number(m[2]) : 0;
  return major < 18 || (major === 18 && minor < 4);
}

let videoEl: HTMLVideoElement | null = null;
let videoUsers = 0;

function startVideo(): () => void {
  videoUsers += 1;
  if (!videoEl) {
    const v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.setAttribute('aria-hidden', 'true');
    v.muted = true;
    v.loop = true;
    v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;';
    const webm = document.createElement('source');
    webm.src = '/nosleep.webm';
    webm.type = 'video/webm';
    const mp4 = document.createElement('source');
    mp4.src = '/nosleep.mp4';
    mp4.type = 'video/mp4';
    v.append(webm, mp4);
    document.body.appendChild(v);
    videoEl = v;
  }
  const v = videoEl;
  const tryPlay = () => {
    if (!v.paused || document.visibilityState !== 'visible') return;
    void v.play().catch(() => {
      // Needs a user tap first on some phones — try again on the next touch.
      window.addEventListener('pointerdown', tryPlay, { once: true, capture: true });
    });
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') tryPlay();
  };
  tryPlay();
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pointerdown', tryPlay, { capture: true });
    videoUsers = Math.max(0, videoUsers - 1);
    if (videoUsers === 0 && videoEl) {
      videoEl.pause();
      videoEl.remove();
      videoEl = null;
    }
  };
}

/**
 * Keep the device screen awake while `enabled` is true (Screen Wake Lock API,
 * with the silent-video fallback for phones that ignore it). Reacquires after
 * the tab or app comes back to the foreground.
 */
export function useScreenWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || typeof document === 'undefined') return;

    const nav = navigator as WakeLockNavigator;
    const stopVideo = needsVideoKeepAwake(nav) ? startVideo() : null;
    if (!nav.wakeLock?.request) {
      return () => stopVideo?.();
    }

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const releaseSentinel = () => {
      const current = sentinel;
      sentinel = null;
      if (!current || current.released) return;
      void current.release().catch(() => {
        /* ignore — already released by the browser */
      });
    };

    const request = async () => {
      try {
        if (cancelled || document.visibilityState !== 'visible') return;
        releaseSentinel();
        const next = await nav.wakeLock!.request('screen');
        if (cancelled || document.visibilityState !== 'visible') {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
        next.addEventListener('release', () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        /* denied: low battery, power save, permissions policy, etc. */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void request();
      } else {
        // Browser releases the lock when hidden; drop our reference.
        sentinel = null;
      }
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);
    // iOS can drop the lock on page show from the back/forward cache.
    window.addEventListener('pageshow', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      releaseSentinel();
      stopVideo?.();
    };
  }, [enabled]);
}
