/**
 * Live Huddle fail-safes for Connect — mirrors PLCC Canaan (Oct 2026):
 *
 *  1. Database down: every successful huddle token comes with a Vault-signed
 *     12-hour permission (fallbackPass). We keep it on the phone; if Vault can't
 *     reach Supabase later, Connect sends it to Vault's voice-token-fallback,
 *     which opens LiveKit without touching the database.
 *  2. LiveKit out of minutes: the channel moves to the backup line (Daily).
 *     Vault records the shared line per channel, so Connect and Vault members
 *     always land on the same line.
 *  3. Hiccups: a failed start is retried twice before falling back or showing
 *     an error.
 *
 * Keys and message formats match Vault so a phone that used both stays in sync.
 */
import { getValidAccessToken, refreshAccessToken } from './authAccessToken';
import { fetchHuddleToken } from './communityChatClient';
import { CommunityChatError, type HuddleJoinToken } from './communityChatTypes';

export type HuddleLine = 'livekit' | 'daily';
export type DailyCredentials = { token: string; url: string };

const BRIDGE = '/api/community-chat';
const QUOTA_KEY = 'livekit_quota_exceeded';
const QUOTA_TTL_MS = 30 * 60 * 1000;
/** Delays before retry #1 and #2 when starting a huddle hits a server hiccup. */
export const HUDDLE_START_RETRY_DELAYS_MS = [700, 1800];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Saved permission (same key as Vault: awc_huddle_fallback_<channelId>)
// ---------------------------------------------------------------------------

export function huddleFallbackStorageKey(channelId: string): string {
  return `awc_huddle_fallback_${channelId}`;
}

/** Read `exp` (seconds) from the pass payload without trusting it — Vault verifies. */
export function fallbackPassExpiry(pass: string): number | null {
  try {
    const payload = pass.split('.')[0] || '';
    const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const exp = Number(JSON.parse(json)?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

export function saveHuddleFallbackPass(channelId: string, pass: unknown): void {
  const value = typeof pass === 'string' ? pass.trim() : '';
  if (!channelId || !value) return;
  try {
    localStorage.setItem(huddleFallbackStorageKey(channelId), value);
  } catch {
    /* private browsing */
  }
}

export function readHuddleFallbackPass(channelId: string, nowMs = Date.now()): string {
  if (!channelId) return '';
  try {
    const value = localStorage.getItem(huddleFallbackStorageKey(channelId)) || '';
    if (!value) return '';
    const exp = fallbackPassExpiry(value);
    if (exp != null && exp * 1000 <= nowMs) {
      localStorage.removeItem(huddleFallbackStorageKey(channelId));
      return '';
    }
    return value;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// LiveKit quota memory (sessionStorage, 30 minutes — same as Vault)
// ---------------------------------------------------------------------------

export function rememberLiveKitQuota(): void {
  try {
    sessionStorage.setItem(QUOTA_KEY, String(Date.now()));
  } catch {
    /* private browsing */
  }
}

export function liveKitQuotaIsFresh(now = Date.now()): boolean {
  try {
    const stamp = Number(sessionStorage.getItem(QUOTA_KEY) || '');
    if (!Number.isFinite(stamp) || stamp <= 0) return false;
    if (now - stamp > QUOTA_TTL_MS) {
      sessionStorage.removeItem(QUOTA_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bridge calls
// ---------------------------------------------------------------------------

async function postBridge(resource: string, body: Record<string, unknown>, opts: { auth?: 'required' | 'optional' } = {}) {
  let token = await getValidAccessToken().catch(() => null);
  if (!token && opts.auth !== 'optional') {
    throw new CommunityChatError('session_missing', 'Please sign in again to continue.', 401, true);
  }
  const send = (bearer: string | null) =>
    fetch(`${BRIDGE}?resource=${resource}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
  let res: Response;
  try {
    res = await send(token);
    if (res.status === 401 && token && opts.auth !== 'optional') {
      token = await refreshAccessToken().catch(() => null);
      if (token) res = await send(token);
    }
  } catch {
    throw new CommunityChatError('network', 'Could not reach PLCC Chat. Check your connection and try again.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

/** Which line this channel's huddle is on right now (null = not set / unknown). */
export async function readHuddleLine(channelId: string): Promise<HuddleLine | null> {
  try {
    const { res, data } = await postBridge('huddle-line', { channelId });
    if (!res.ok) return null;
    return data.provider === 'daily' || data.provider === 'livekit' ? data.provider : null;
  } catch {
    return null;
  }
}

/** Record the line we joined. If someone already moved the channel, Vault says which. */
export async function claimHuddleLine(
  channelId: string,
  provider: HuddleLine
): Promise<{ ok: true } | { ok: false; provider: HuddleLine | null; occupied: boolean }> {
  try {
    const { res, data } = await postBridge('huddle-line', { channelId, provider });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      provider: data.provider === 'daily' || data.provider === 'livekit' ? data.provider : null,
      occupied: data.occupied === true,
    };
  } catch {
    // Can't confirm — stay on the line we're on rather than bouncing people.
    return { ok: true };
  }
}

export async function fetchDailyCredentials(channelId: string): Promise<DailyCredentials> {
  const { res, data } = await postBridge('huddle-daily-token', { channelId });
  if (!res.ok || typeof data.token !== 'string' || typeof data.url !== 'string') {
    throw new CommunityChatError(
      (String(data.code || 'backup_line_unavailable') as CommunityChatError['code']),
      String(data.message || 'Backup huddle audio is unavailable right now.'),
      res.status
    );
  }
  return { token: data.token, url: data.url };
}

async function fetchFallbackToken(channelId: string, fallbackPass: string): Promise<HuddleJoinToken> {
  const { res, data } = await postBridge('huddle-token-fallback', { channelId, fallbackPass }, { auth: 'optional' });
  if (!res.ok || typeof data.token !== 'string' || typeof data.url !== 'string') {
    throw new CommunityChatError(
      (String(data.code || 'vault_unavailable') as CommunityChatError['code']),
      String(data.message || 'Could not open the huddle while the church database is down.'),
      res.status
    );
  }
  return {
    token: data.token,
    url: data.url,
    roomName: String(data.roomName || ''),
    expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 0,
    canModerate: Boolean(data.canModerate),
    channelId: String(data.channelId || channelId),
    channelName: String(data.channelName || 'Live Huddle'),
    fallback: true,
  };
}

/** Errors worth retrying / falling back on: server trouble or no connection. */
export function isServerHiccup(err: unknown): boolean {
  if (!(err instanceof CommunityChatError)) return true;
  return err.status === 0 || err.status >= 500 || err.code === 'network' || err.code === 'vault_unavailable' || err.code === 'huddle_unavailable';
}

/** When the database is down, Vault can't verify the session either (401). */
function databaseMayBeDown(err: unknown): boolean {
  if (isServerHiccup(err)) return true;
  return err instanceof CommunityChatError && (err.status === 401 || err.code === 'session_missing');
}

/**
 * Get a LiveKit token: normal path with two retries, then the saved permission.
 * Saves any new permission Vault hands back.
 */
export async function fetchHuddleTokenResilient(
  channelId: string,
  opts: { onRetry?: (attempt: number) => void; delaysMs?: number[] } = {}
): Promise<HuddleJoinToken> {
  const delays = opts.delaysMs ?? HUDDLE_START_RETRY_DELAYS_MS;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const token = await fetchHuddleToken(channelId);
      saveHuddleFallbackPass(channelId, token.fallbackPass);
      return token;
    } catch (err) {
      lastErr = err;
      if (!isServerHiccup(err) || attempt === delays.length) break;
      opts.onRetry?.(attempt + 1);
      await sleep(delays[attempt]);
    }
  }
  const saved = readHuddleFallbackPass(channelId);
  if (saved && databaseMayBeDown(lastErr)) {
    try {
      return await fetchFallbackToken(channelId, saved);
    } catch (fallbackErr) {
      lastErr = fallbackErr;
    }
  }
  if (lastErr instanceof CommunityChatError && isServerHiccup(lastErr)) {
    throw new CommunityChatError(
      lastErr.code,
      saved
        ? 'Could not open the huddle while the church database is down. Please try again in a minute.'
        : 'The church database is temporarily unavailable. Please try again in a minute.',
      lastErr.status
    );
  }
  throw lastErr;
}

/**
 * Decide the shared line before joining (same rule as Vault joinHuddle):
 * Daily if the channel is already on Daily, or LiveKit just ran out of minutes.
 */
export async function planHuddleLine(
  channelId: string
): Promise<{ provider: 'livekit' } | { provider: 'daily'; creds: DailyCredentials } | { provider: 'blocked'; error: string }> {
  const line = await readHuddleLine(channelId);
  const useDaily = line === 'daily' || (line === null && liveKitQuotaIsFresh());
  if (!useDaily) return { provider: 'livekit' };
  try {
    return { provider: 'daily', creds: await fetchDailyCredentials(channelId) };
  } catch (err) {
    return {
      provider: 'blocked',
      error: err instanceof Error && err.message ? err.message : 'Backup huddle audio is unavailable right now.',
    };
  }
}
