/**
 * After a new deploy, a phone that still has the old Connect open asks for
 * script files that no longer exist. React.lazy remembers that failure, so the
 * screen shows "Couldn't load …" until a full reload. These helpers detect that
 * case and reload once (guarded so it can never loop).
 */

const RELOAD_KEY = 'awc_stale_build_reload_at';
/** Never auto-reload more than once in this window. */
export const STALE_RELOAD_GUARD_MS = 30_000;

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|is not a valid JavaScript MIME type|ChunkLoadError|Loading chunk [\w-]+ failed/i;

export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '');
  return CHUNK_ERROR_RE.test(msg) || (err as { name?: string })?.name === 'ChunkLoadError';
}

/**
 * Nov 19 2026: never reload in the middle of a Ka Link — that hung up the call the first
 * time someone opened the Bible after a deploy. During a call the section shows
 * "updated, tap Retry"; the reload happens by itself once the call ends.
 */
let callActive = false;
let reloadAfterCall = false;

export function isCallActive(): boolean {
  return callActive;
}

export function setCallActive(on: boolean): void {
  callActive = on;
  if (!on && reloadAfterCall) {
    reloadAfterCall = false;
    reloadOnceForNewVersion();
  }
}

/** Reload the page once to pick up the new version. Returns true if reloading. */
export function reloadOnceForNewVersion(now = Date.now()): boolean {
  if (callActive) {
    reloadAfterCall = true;
    return false;
  }
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Number.isFinite(last) && now - last < STALE_RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // Without storage we can't guard against loops — let the person tap Retry.
    return false;
  }
  window.location.reload();
  return true;
}
