import React, { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

/**
 * PLCC ONE — one sign-on landing.
 * The PLCC ONE launcher (in the Vault) opens /auth/sso#th=<token hash>&next=/path.
 * The token is a single-use Supabase magic-link token minted for this member, so
 * verifying it gives this app its own fresh session (no password, no second code).
 * The hash is scrubbed from the address bar before anything else happens.
 */
function safeNext(raw: string | null, fallback: string): string {
  const v = String(raw || '').trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return fallback;
  return v;
}

export const SsoHandoff: React.FC<{
  fallback: string;
  signInPath: string;
  /** localStorage flags to set once signed in (e.g. skip a first-visit splash). */
  seenKeys?: string[];
}> = ({ fallback, signInPath, seenKeys }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const tokenHash = params.get('th') || '';
    const next = safeNext(params.get('next'), fallback);
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      /* ignore */
    }
    if (!tokenHash || !isSupabaseConfigured) {
      window.location.replace(next);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
      if (cancelled) return;
      if (error) {
        // Token used or expired. If this browser is already signed in, just go on.
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          window.location.replace(next);
          return;
        }
        console.error('[sso]', error.status || '', error.code || '');
        setFailed(true);
        return;
      }
      try {
        (seenKeys || []).forEach((k) => localStorage.setItem(k, 'true'));
      } catch {
        /* private mode */
      }
      // Full load so the app starts with the new session in place.
      window.location.replace(next);
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: 'radial-gradient(140% 70% at 50% 30%, #213d30 0%, #182e24 45%, #0d1914 100%)', color: '#fff' }}
    >
      {failed ? (
        <>
          <h1 className="text-2xl font-black">Please sign in once more</h1>
          <p className="max-w-sm text-base" style={{ color: '#F3E3D0' }}>
            That sign-in link was already used or has expired.
          </p>
          <a
            href={signInPath}
            className="mt-2 inline-flex min-h-[52px] items-center rounded-2xl px-6 text-lg font-black"
            style={{ background: 'linear-gradient(180deg, #FFE08A 0%, #E4C98F 45%, #C98F1E 100%)', color: '#112019' }}
          >
            Sign in
          </a>
        </>
      ) : (
        <>
          <div
            className="w-12 h-12 rounded-full border-4 animate-spin"
            style={{ borderColor: 'rgba(245,196,81,0.3)', borderTopColor: '#E4C98F' }}
            aria-hidden
          />
          <p className="text-lg font-bold" role="status">Signing you in with PLCC ONE…</p>
        </>
      )}
    </main>
  );
};

export default SsoHandoff;
