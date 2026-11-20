/**
 * "A new version is ready" — checks /version.json (written by each build) against the
 * version this copy of the app was built with. Pure helpers + the fetch, so it is easy to test.
 */
declare const __APP_BUILD_ID__: string;

export const BUILD_ID: string = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
/** How often an open app looks for a new version. */
export const UPDATE_CHECK_MS = 5 * 60 * 1000;
/** "Later" hides the banner this long (unless the update is marked important). */
export const UPDATE_SNOOZE_MS = 60 * 60 * 1000;

export type LatestVersion = { id: string; notes: string; critical: boolean };

export function parseVersionFile(raw: unknown): LatestVersion | null {
  const j = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const id = typeof j?.id === 'string' ? j.id.trim() : '';
  if (!id || id.length > 64) return null;
  return { id, notes: typeof j?.notes === 'string' ? j.notes.slice(0, 280) : '', critical: j?.critical === true };
}

/** Is there a newer build than the one running? Never in local dev. */
export function hasUpdate(latest: LatestVersion | null, current = BUILD_ID): boolean {
  if (!latest || !current || current === 'dev' || current.startsWith('local-')) return false;
  return latest.id !== current;
}

export async function fetchLatestVersion(): Promise<LatestVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return parseVersionFile(await res.json());
  } catch {
    return null;
  }
}

const SNOOZE_KEY = 'plcc_update_snooze';

export function isSnoozed(id: string, now = Date.now()): boolean {
  try {
    const [sid, at] = String(localStorage.getItem(SNOOZE_KEY) || '').split('|');
    return sid === id && now - Number(at) < UPDATE_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function snooze(id: string, now = Date.now()): void {
  try {
    localStorage.setItem(SNOOZE_KEY, `${id}|${now}`);
  } catch {
    /* private mode */
  }
}

/** Load the new version (also refreshes the alerts worker). */
export async function reloadToNewVersion(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.update();
  } catch {
    /* no worker */
  }
  window.location.reload();
}
