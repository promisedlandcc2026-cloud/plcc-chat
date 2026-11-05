import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { goToReturnPath } from '../lib/authReturnPath';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { AWCLogo } from '../components/ui/AWCLogo';

type CallbackState = 'working' | 'success' | 'error';

/**
 * Handles magic-link / PKCE redirects from Supabase Auth.
 * Relies on detectSessionInUrl — does not parse or display tokens.
 */
export const AuthCallback: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>('working');
  const [message, setMessage] = useState('Completing sign-in…');

  useEffect(() => {
    let cancelled = false;
    let finishTimer: number | undefined;

    const finish = async () => {
      if (!isSupabaseConfigured) {
        if (!cancelled) {
          setState('error');
          setMessage('Sign-in is not configured on this deployment.');
        }
        return;
      }

      try {
        // Exchange code if present (PKCE); ignore errors when already hashed session
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('[auth callback]', error.code || '', error.status || '');
            if (!cancelled) {
              setState('error');
              setMessage(
                /expired/i.test(error.message || '')
                  ? 'That sign-in link has expired. Please request a new code.'
                  : 'This sign-in link is invalid or has already been used. Please request a new code.'
              );
            }
            scrubAuthParamsFromUrl();
            return;
          }
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error('[auth callback getSession]', error.code || '', error.status || '');
          if (!cancelled) {
            setState('error');
            setMessage('We could not complete sign-in. Please try again from Member Sign In.');
          }
          scrubAuthParamsFromUrl();
          return;
        }

        scrubAuthParamsFromUrl();

        if (!data.session) {
          if (!cancelled) {
            setMessage('Finishing sign-in…');
          }
          finishTimer = window.setTimeout(() => {
            if (cancelled) return;
            void supabase.auth.getSession().then(({ data: again }) => {
              if (cancelled) return;
              scrubAuthParamsFromUrl();
              if (again.session) {
                setState('success');
                goToReturnPath(navigate, '/account');
              } else {
                setState('error');
                setMessage(
                  'We could not find a sign-in session. The link may be missing or expired. Please request a new code.'
                );
              }
            });
          }, 1500);
          return;
        }

        if (!cancelled) {
          setState('success');
          setMessage('You are signed in. Taking you back…');
          goToReturnPath(navigate, '/account');
        }
      } catch {
        if (!cancelled) {
          setState('error');
          setMessage('Network error while completing sign-in. Please try again.');
        }
        scrubAuthParamsFromUrl();
      }
    };

    void finish();
    return () => {
      cancelled = true;
      if (finishTimer !== undefined) window.clearTimeout(finishTimer);
    };
  }, [navigate]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && state !== 'error') {
      goToReturnPath(navigate, '/account');
    }
  }, [isLoading, isAuthenticated, navigate, state]);

  return (
    <main className="flex-1 px-6 py-16 flex flex-col items-center text-center pb-28">
      <AWCLogo size={80} className="mb-6" />
      {state === 'working' && (
        <>
          <Loader2 className="animate-spin text-burgundy mb-4" size={28} aria-hidden />
          <p className="text-sm text-gray-600" role="status">
            {message}
          </p>
        </>
      )}
      {state === 'success' && (
        <p className="text-sm text-gray-600" role="status">
          {message}
        </p>
      )}
      {state === 'error' && (
        <div className="space-y-4 max-w-sm">
          <p className="text-sm text-red-800 bg-red-50 border border-red-100 rounded-2xl px-4 py-3" role="alert">
            {message}
          </p>
          <Link
            to="/sign-in"
            className="inline-flex min-h-[44px] items-center justify-center px-5 rounded-2xl bg-burgundy text-white text-sm font-bold"
          >
            Back to Member Sign In
          </Link>
          <div>
            <Link to="/" className="text-sm font-bold text-burgundy underline">
              Continue as visitor
            </Link>
          </div>
        </div>
      )}
    </main>
  );
};

function scrubAuthParamsFromUrl() {
  try {
    const url = new URL(window.location.href);
    const sensitive = [
      'code',
      'state',
      'error',
      'error_description',
      'error_code',
      'access_token',
      'refresh_token',
      'token_type',
      'expires_in',
      'expires_at',
      'provider_token',
      'provider_refresh_token',
      'type',
    ];
    let changed = false;
    for (const key of sensitive) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (url.hash && /access_token|refresh_token|error/i.test(url.hash)) {
      url.hash = '';
      changed = true;
    }
    if (changed) {
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
    }
  } catch {
    /* ignore */
  }
}
