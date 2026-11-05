import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { isFatalRefreshError, refreshSessionOnce } from '../lib/authAccessToken';
import { sendEmailOtp, signOutSession, verifyEmailOtp } from '../lib/authOtp';
import {
  signInWithPhoneCode,
  signInWithPhonePassword,
  signUpWithPhone,
  type PhoneSignUpInput,
} from '../lib/authPhoneClient';
import {
  authAccessLevelFromMemberState,
  memberAccessFromIdentity,
  type AuthAccessLevel,
  type AuthStatus,
  type ConnectMemberIdentity,
  type MemberAccessState,
} from '../lib/authTypes';
import { fetchMemberSelf, MemberSelfError } from '../lib/memberSelfClient';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** Phase 1 compatibility: derived from memberAccessState. */
  accessLevel: AuthAccessLevel;
  memberAccessState: MemberAccessState;
  identity: ConnectMemberIdentity | null;
  identityLoading: boolean;
  identityError: string | null;
  identityErrorCode: string | null;
  errorMessage: string | null;
  isConfigured: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  clearError: () => void;
  signInWithOtp: (
    email: string,
    profile?: { firstName: string; lastName: string }
  ) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  signInWithPhone: (phone: string, password: string) => Promise<void>;
  signUpWithPhonePassword: (input: PhoneSignUpInput) => Promise<void>;
  /** Texted code: sign in, or create the account when `signup` is given. */
  signInWithPhoneCode: (
    phone: string,
    code: string,
    signup?: { firstName: string; lastName: string; email?: string }
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
  /** Apply a freshly returned member-self DTO (e.g. after PATCH) without a second GET. */
  applyIdentity: (member: ConnectMemberIdentity) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [identity, setIdentity] = useState<ConnectMemberIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityErrorCode, setIdentityErrorCode] = useState<string | null>(null);

  const identityRequestId = useRef(0);
  const authUserIdRef = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const recoveringRef = useRef(false);
  /** Set while the member taps Sign out, so that SIGNED_OUT is applied at once. */
  const signingOutRef = useRef(false);
  /** Identity check failed (e.g. network blip on wake) — retry when the app is back. */
  const identityFailedRef = useRef(false);

  const clearIdentity = useCallback(() => {
    identityRequestId.current += 1;
    setIdentity(null);
    setIdentityLoading(false);
    setIdentityError(null);
    setIdentityErrorCode(null);
  }, []);

  const loadIdentity = useCallback(async (authUserId: string) => {
    const requestId = ++identityRequestId.current;
    setIdentityLoading(true);
    setIdentityError(null);
    setIdentityErrorCode(null);

    try {
      const member = await fetchMemberSelf();
      if (requestId !== identityRequestId.current) return;
      if (authUserIdRef.current !== authUserId) return;
      identityFailedRef.current = false;
      setIdentity(member);
      setIdentityError(null);
      setIdentityErrorCode(null);
    } catch (err) {
      if (requestId !== identityRequestId.current) return;
      if (authUserIdRef.current !== authUserId) return;
      identityFailedRef.current = true;
      setIdentity(null);
      if (err instanceof MemberSelfError) {
        setIdentityError(err.message);
        setIdentityErrorCode(err.code);
      } else {
        setIdentityError('We could not verify your member access right now. Please try again.');
        setIdentityErrorCode('vault_unavailable');
      }
    } finally {
      if (requestId === identityRequestId.current) {
        setIdentityLoading(false);
      }
    }
  }, []);

  const applySession = useCallback(
    (next: Session | null) => {
      const nextUserId = next?.user?.id ? String(next.user.id) : null;
      const prevUserId = authUserIdRef.current;

      sessionRef.current = next;
      setSession(next);
      setUser(next?.user ?? null);
      setStatus(next?.user ? 'signed_in' : 'signed_out');
      authUserIdRef.current = nextUserId;

      if (!nextUserId) {
        clearIdentity();
        return;
      }

      if (nextUserId !== prevUserId) {
        setIdentity(null);
        setIdentityError(null);
        setIdentityErrorCode(null);
        void loadIdentity(nextUserId);
      }
    },
    [clearIdentity, loadIdentity]
  );

  /**
   * Phone wake / tab return can make Supabase report SIGNED_OUT for a login that
   * is still good (a refresh raced another tab or a frozen timer). Before
   * kicking the member out: wait a moment, re-read the stored session, and if
   * it's gone but our in-memory access token hasn't expired, put it back.
   * Only a session that truly can't be recovered signs them out.
   */
  const confirmSessionGone = useCallback(async (): Promise<Session | null> => {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) return data.session;
    } catch {
      /* fall through */
    }
    const prev = sessionRef.current;
    if (prev?.access_token && prev.refresh_token) {
      try {
        const { data, error } = await supabase.auth.setSession({
          access_token: prev.access_token,
          refresh_token: prev.refresh_token,
        });
        if (!error && data.session) return data.session;
      } catch {
        /* not recoverable */
      }
    }
    return null;
  }, []);

  const recoverSession = useCallback(async () => {
    if (!isSupabaseConfigured || recoveringRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    recoveringRef.current = true;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('[auth recover getSession]', error.code || '', error.status || '');
      }

      let next = data.session;
      if (!next) {
        // Do not wipe an in-memory session on a transient empty read while recovering.
        if (!sessionRef.current) return;
        next = sessionRef.current;
      }

      const expiresAtMs = (next.expires_at ?? 0) * 1000;
      const needsRefresh = !expiresAtMs || expiresAtMs <= Date.now() + 60_000;
      if (!needsRefresh) {
        applySession(next);
        return;
      }

      const first = await refreshSessionOnce();
      if (first.session) {
        applySession(first.session);
        return;
      }

      if (first.error) {
        console.error('[auth recover refresh]', first.error.code || '', first.error.status || '');
      }

      if (first.error && isFatalRefreshError(first.error)) {
        const kept = await confirmSessionGone();
        if (kept) {
          applySession(kept);
          return;
        }
        applySession(null);
        setErrorMessage('Your session expired. Please sign in again.');
        return;
      }

      // Transient refresh failure — keep the existing session if still present.
      if (sessionRef.current || next) {
        applySession(sessionRef.current || next);
      }
    } catch (err) {
      console.error('[auth recover]', err instanceof Error ? err.message : 'unknown');
    } finally {
      recoveringRef.current = false;
    }
  }, [applySession, confirmSessionGone]);

  useEffect(() => {
    let cancelled = false;

    if (!isSupabaseConfigured) {
      setStatus('signed_out');
      setSession(null);
      setUser(null);
      clearIdentity();
      return;
    }

    const bootstrap = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          console.error('[auth getSession]', error.code || '', error.status || '');
          if (data?.session) {
            applySession(data.session);
            return;
          }
          // One soft retry before treating as signed out
          const retry = await supabase.auth.getSession();
          if (cancelled) return;
          if (retry.data.session) {
            applySession(retry.data.session);
            return;
          }
          setErrorMessage(
            'We could not restore your sign-in. You can continue browsing or try signing in again.'
          );
          applySession(null);
          return;
        }

        applySession(data.session);
      } catch {
        if (cancelled) return;
        setErrorMessage('Network unavailable while checking sign-in. Public pages still work.');
        // Keep prior in-memory session if any; otherwise soft signed-out.
        if (!sessionRef.current) {
          setStatus('signed_out');
        }
      }
    };

    void bootstrap();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, nextSession) => {
        if (cancelled) return;

        if (event === 'SIGNED_OUT') {
          if (signingOutRef.current) {
            applySession(null);
            return;
          }
          // Not a sign-out the member asked for — make sure before kicking them out.
          void confirmSessionGone().then((kept) => {
            if (cancelled) return;
            applySession(kept);
          });
          return;
        }

        if (
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED' ||
          event === 'PASSWORD_RECOVERY'
        ) {
          if (nextSession) applySession(nextSession);
          return;
        }

        if (event === 'INITIAL_SESSION') {
          applySession(nextSession);
          return;
        }

        // Ignore null session on unknown/non-sign-out events
        if (nextSession) applySession(nextSession);
      }
    );

    const retryIdentityIfNeeded = () => {
      const id = authUserIdRef.current;
      if (id && identityFailedRef.current) void loadIdentity(id);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recoverSession().then(retryIdentityIfNeeded);
    };
    const onOnline = () => {
      void recoverSession().then(retryIdentityIfNeeded);
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      identityRequestId.current += 1;
      subscription.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [applySession, clearIdentity, confirmSessionGone, loadIdentity, recoverSession]);

  const clearError = useCallback(() => setErrorMessage(null), []);

  const signInWithOtp = useCallback(
    async (email: string, profile?: { firstName: string; lastName: string }) => {
      setErrorMessage(null);
      const firstName = profile?.firstName.trim() || '';
      const lastName = profile?.lastName.trim() || '';
      await sendEmailOtp(email, {
        createUser: Boolean(firstName && lastName),
        firstName,
        lastName,
      });
    },
    []
  );

  const verifyOtp = useCallback(
    async (email: string, token: string) => {
      setErrorMessage(null);
      const next = await verifyEmailOtp(email, token);
      applySession(next);
    },
    [applySession]
  );

  const signInWithPhone = useCallback(
    async (phone: string, password: string) => {
      setErrorMessage(null);
      const next = await signInWithPhonePassword(phone, password);
      applySession(next);
    },
    [applySession]
  );

  const signUpWithPhonePassword = useCallback(
    async (input: PhoneSignUpInput) => {
      setErrorMessage(null);
      const next = await signUpWithPhone(input);
      applySession(next);
    },
    [applySession]
  );

  const signInWithPhoneCodeCb = useCallback(
    async (phone: string, code: string, signup?: { firstName: string; lastName: string; email?: string }) => {
      setErrorMessage(null);
      const next = await signInWithPhoneCode(phone, code, signup);
      applySession(next);
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    setErrorMessage(null);
    signingOutRef.current = true;
    try {
      await signOutSession();
      applySession(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'We could not sign you out. Please try again.';
      setErrorMessage(message);
      throw err;
    } finally {
      signingOutRef.current = false;
    }
  }, [applySession]);

  const refreshSession = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { session: next, error } = await refreshSessionOnce();
    if (next) {
      applySession(next);
      return;
    }
    if (error) {
      console.error('[auth refreshSession]', error.code || '', error.status || '');
      if (isFatalRefreshError(error)) {
        applySession(await confirmSessionGone());
      }
    }
    // Transient — keep current session
  }, [applySession, confirmSessionGone]);

  const refreshIdentity = useCallback(async () => {
    const id = authUserIdRef.current;
    if (!id) return;
    await loadIdentity(id);
  }, [loadIdentity]);

  const applyIdentity = useCallback((member: ConnectMemberIdentity) => {
    if (!authUserIdRef.current) return;
    if (member.id !== authUserIdRef.current) return;
    identityRequestId.current += 1;
    setIdentity(member);
    setIdentityLoading(false);
    setIdentityError(null);
    setIdentityErrorCode(null);
  }, []);

  const isAuthenticated = Boolean(session?.user);
  const memberAccessState = memberAccessFromIdentity({
    isAuthenticated,
    identityLoading,
    identity,
    identityErrorCode,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user,
      accessLevel: authAccessLevelFromMemberState(memberAccessState),
      memberAccessState,
      identity,
      identityLoading,
      identityError,
      identityErrorCode,
      errorMessage,
      isConfigured: isSupabaseConfigured,
      isAuthenticated,
      isLoading: status === 'loading',
      clearError,
      signInWithOtp,
      verifyOtp,
      signInWithPhone,
      signUpWithPhonePassword,
      signInWithPhoneCode: signInWithPhoneCodeCb,
      signOut,
      refreshSession,
      refreshIdentity,
      applyIdentity,
    }),
    [
      status,
      session,
      user,
      memberAccessState,
      identity,
      identityLoading,
      identityError,
      identityErrorCode,
      errorMessage,
      isAuthenticated,
      clearError,
      signInWithOtp,
      verifyOtp,
      signInWithPhone,
      signUpWithPhonePassword,
      signInWithPhoneCodeCb,
      signOut,
      refreshSession,
      refreshIdentity,
      applyIdentity,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export { AuthProvider };

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
