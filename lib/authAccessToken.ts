import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';

const REFRESH_SKEW_MS = 60_000;

function isJwt(token: string | null | undefined): token is string {
  return Boolean(token && token.split('.').length === 3);
}

function isFatalRefreshError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const hay = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    hay.includes('refresh_token_not_found') ||
    hay.includes('invalid_grant') ||
    hay.includes('session_not_found') ||
    hay.includes('invalid refresh token') ||
    hay.includes('refresh token not found')
  );
}

type RefreshOutcome = {
  session: Session | null;
  error: { code?: string; message?: string; status?: number } | null;
};

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * One refresh at a time for the whole app. When a phone wakes or a tab comes
 * back, several screens ask for a fresh token at once; parallel refreshes
 * reuse the same one-time refresh token and Supabase then signs the member
 * out. Every caller shares this promise instead. After a failed refresh the
 * stored session is re-read, because another tab may have refreshed it.
 */
export function refreshSessionOnce(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async (): Promise<RefreshOutcome> => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) return { session: data.session, error: null };
      const again = await supabase.auth.getSession().catch(() => null);
      const stored = again?.data.session ?? null;
      const storedOk = Boolean(stored?.access_token && (stored.expires_at ?? 0) * 1000 > Date.now());
      return { session: storedOk ? stored : null, error: error ?? null };
    } catch (err) {
      return { session: null, error: { message: err instanceof Error ? err.message : 'refresh failed' } };
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Return a usable Supabase access token, refreshing when near expiry.
 * Never logs the token.
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[authAccessToken] getSession', error.code || '', error.status || '');
  }

  let session = data.session;
  if (!session?.access_token) return null;

  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  const needsRefresh = !expiresAtMs || expiresAtMs <= Date.now() + REFRESH_SKEW_MS;

  if (needsRefresh) {
    const refreshed = await refreshSessionOnce();
    if (refreshed.session) {
      session = refreshed.session;
    } else if (refreshed.error) {
      console.error('[authAccessToken] refreshSession', refreshed.error.code || '', refreshed.error.status || '');
      // Keep the existing token if refresh failed for a non-fatal reason and it is not expired yet.
      if (isFatalRefreshError(refreshed.error) || expiresAtMs <= Date.now()) {
        return null;
      }
    }
  }

  const token = session?.access_token ?? null;
  return isJwt(token) ? token : null;
}

/**
 * Force one refresh (e.g. after an API 401), then return the new access token.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { session, error } = await refreshSessionOnce();
  if (session) {
    const token = session.access_token ?? null;
    return isJwt(token) ? token : null;
  }
  if (error) {
    console.error('[authAccessToken] forceRefresh', error.code || '', error.status || '');
    if (isFatalRefreshError(error)) return null;
  }
  return getValidAccessToken();
}

export { isFatalRefreshError };
