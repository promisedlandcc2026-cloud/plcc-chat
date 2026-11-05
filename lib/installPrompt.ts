/**
 * "Add PLCC Connect to your home screen" — ask once, then stop.
 *
 * We never ask again when:
 *  - Connect is already running as the installed app (home-screen icon);
 *  - the person installed it (Android/Chrome reports this), or tapped "I've added it";
 *  - the person tapped "Not now" in the last 14 days (then we ask once more).
 *
 * Android/Chrome can also confirm on later visits that the app is installed
 * (getInstalledRelatedApps + manifest related_applications). iPhone Safari
 * never tells a website it was added to the home screen, hence "I've added it".
 */

const STORAGE_KEY = 'awc_install_prompt'; // 'dismissed' | 'installed'
const DISMISSED_AT_KEY = 'awc_install_prompt_dismissed_at';
const LEGACY_DISMISSED_KEY = 'awc_pwa_dismissed';
/** After "Not now", ask again this many days later. */
export const ASK_AGAIN_AFTER_DAYS = 14;

export type InstallPlatform = 'ios' | 'android' | 'other';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function readFlag(): string | null {
  try {
    const flag = localStorage.getItem(STORAGE_KEY) || (localStorage.getItem(LEGACY_DISMISSED_KEY) ? 'dismissed' : null);
    if (flag !== 'dismissed') return flag;
    // "Not now" is a pause, not a forever: ask once more after a couple of weeks.
    const at = Number(localStorage.getItem(DISMISSED_AT_KEY) || 0);
    if (!at) {
      // Dismissed before we kept a date: start the clock now.
      localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
      return flag;
    }
    if (Date.now() - at < ASK_AGAIN_AFTER_DAYS * 24 * 60 * 60 * 1000) return flag;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_DISMISSED_KEY);
    localStorage.removeItem(DISMISSED_AT_KEY);
    return null;
  } catch {
    return null;
  }
}

function writeFlag(value: 'dismissed' | 'installed') {
  try {
    localStorage.setItem(STORAGE_KEY, value);
    if (value === 'dismissed') localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    else localStorage.removeItem(DISMISSED_AT_KEY);
  } catch {
    /* private mode: nothing to remember */
  }
  notify();
}

export function markInstallDismissed() {
  writeFlag('dismissed');
}

export function markInstalled() {
  writeFlag('installed');
}

/** True when Connect is open from the home-screen icon (not a browser tab). */
export function isRunningInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches === true
  );
}

export function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'other';
}

/** iPhone browsers other than Safari: adding works best from Safari, so we point there. */
export function isIosNonSafari(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  return detectInstallPlatform() === 'ios' && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua);
}

export function canPromptNatively(): boolean {
  return deferredPrompt !== null;
}

/** Shows Chrome's own install dialog. Returns true if they installed. */
export async function promptNativeInstall(): Promise<boolean> {
  const ev = deferredPrompt;
  if (!ev) return false;
  deferredPrompt = null;
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice.outcome === 'accepted') {
      markInstalled();
      return true;
    }
    markInstallDismissed(); // they said no in Chrome's dialog: don't ask again
  } catch {
    notify();
  }
  return false;
}

/** Android/Chrome: is this web app already installed on the device? */
async function alreadyInstalledOnDevice(): Promise<boolean> {
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform: string }>>;
  };
  if (!nav.getInstalledRelatedApps) return false;
  try {
    const apps = await nav.getInstalledRelatedApps();
    return apps.some((a) => a.platform === 'webapp');
  } catch {
    return false;
  }
}

/** Whether to show the prompt at all. Records "installed" when it can tell. */
export async function shouldAskToInstall(): Promise<boolean> {
  if (isRunningInstalled()) {
    markInstalled();
    return false;
  }
  if (readFlag()) return false;
  if (detectInstallPlatform() === 'other' && !deferredPrompt) return false; // computers
  if (await alreadyInstalledOnDevice()) {
    markInstalled();
    return false;
  }
  return true;
}

export function subscribeInstallPrompt(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Call once at startup: Chrome fires these before React mounts. */
export function initInstallPrompt() {
  if (typeof window === 'undefined') return;
  if (isRunningInstalled()) {
    markInstalled();
    return;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own friendly prompt instead
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markInstalled();
  });
}
