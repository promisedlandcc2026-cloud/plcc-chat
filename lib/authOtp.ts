import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Email redirect for OTP / magic-link flows.
 * Prefer VITE_AUTH_REDIRECT_URL when set; otherwise derive from the Connect origin.
 * Must be listed in Supabase Auth → Redirect URLs.
 */
export function getAuthRedirectUrl(): string {
  const explicit = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim();
  if (explicit) return explicit;
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/auth/callback`;
}

function toFriendlyAuthError(error: { message?: string; status?: number; code?: string }): Error {
  const raw = error.message || 'Request failed';
  if (error.status === 500 || /error sending|internal server error/i.test(raw)) {
    console.error('[auth email send]', error.code || '', error.status || '');
    return new Error(
      'We could not send your sign-in code right now. Please try again in a few minutes.'
    );
  }
  if (/rate limit|too many/i.test(raw)) {
    return new Error('Too many attempts. Please wait a moment and try again.');
  }
  if (/invalid.*email|email.*invalid/i.test(raw)) {
    return new Error('Please enter a valid email address.');
  }
  if (/expired|otp_expired/i.test(raw)) {
    return new Error('That code or link has expired. Please request a new one.');
  }
  if (/signups not allowed|signup_disabled|user not found|otp_disabled/i.test(raw + (error.code || ''))) {
    return new Error(
      'No account for that email yet. Create an account and enter your first and last name.'
    );
  }
  if (/invalid|token|otp/i.test(raw)) {
    return new Error('That code is not valid. Please check it and try again.');
  }
  // Generic — avoid leaking provider internals or account-existence hints
  return new Error('Something went wrong with sign-in. Please try again.');
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Send a 6-digit email OTP. A new account is created only when both names are provided. */
export async function sendEmailOtp(
  email: string,
  opts?: { createUser?: boolean; firstName?: string; lastName?: string }
): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Sign-in is not configured yet. Please try again later or contact the church office.');
  }
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) {
    throw new Error('Please enter a valid email address.');
  }

  const firstName = String(opts?.firstName || '').trim();
  const lastName = String(opts?.lastName || '').trim();
  const createUser = opts?.createUser === true;
  if (createUser && (!firstName || !lastName)) {
    throw new Error('First and last name are required.');
  }

  const emailRedirectTo = getAuthRedirectUrl();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: {
      shouldCreateUser: createUser,
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
      ...(createUser ? { data: { first_name: firstName, last_name: lastName } } : {}),
    },
  });
  if (error) throw toFriendlyAuthError(error);
}

/** Verify the 6-digit code emailed to the member. */
export async function verifyEmailOtp(email: string, token: string) {
  if (!isSupabaseConfigured) {
    throw new Error('Sign-in is not configured yet. Please try again later or contact the church office.');
  }
  const normalized = email.trim().toLowerCase();
  const code = token.replace(/\s/g, '');
  if (code.length < 6) {
    throw new Error('Please enter the 6-digit code from your email.');
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email: normalized,
    token: code,
    type: 'email',
  });
  if (error) throw toFriendlyAuthError(error);
  return data.session;
}

export async function signOutSession(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('[auth signOut]', error.code || '', error.status || '');
    throw new Error('We could not sign you out completely. Please try again.');
  }
}
