import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';

export type PhoneSignUpInput = {
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  email?: string;
};

/** Loosely check if a string looks like a phone number (starts with + or digit). */
export function isPhoneNumber(value: string): boolean {
  const v = String(value || '').trim();
  return /^[+\d]/.test(v) && v.replace(/\D/g, '').length >= 7;
}

/** Normalise phone to E.164. US 10-digit numbers become +1… */
export function normalisePhone(value: string): string {
  const trimmed = String(value || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (trimmed.startsWith('+') && digits.length >= 10) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return trimmed.startsWith('+') ? `+${digits}` : `+1${digits}`;
}

function toFriendlyPhoneAuthError(status: number, message: string): Error {
  const raw = message || 'Request failed';
  if (status === 429 || /too many/i.test(raw)) {
    return new Error('Too many tries. Wait a few minutes, then try again.');
  }
  if (status === 409 || /already uses/i.test(raw)) {
    return new Error(raw);
  }
  if (status === 400 && /password/i.test(raw)) {
    return new Error(raw);
  }
  if (status === 400 && /name/i.test(raw)) {
    return new Error(raw);
  }
  if (status === 400 && /mobile|phone|valid/i.test(raw)) {
    return new Error('Enter a valid mobile number.');
  }
  if (status === 401 || /incorrect/i.test(raw)) {
    return new Error('That phone number or password is incorrect.');
  }
  if (status === 503) {
    return new Error('Phone sign-in is not available right now. Please try again later.');
  }
  return new Error(raw || 'Something went wrong with phone sign-in. Please try again.');
}

async function applySessionFromTokens(opts: {
  access_token: string;
  refresh_token: string;
}): Promise<Session> {
  if (!isSupabaseConfigured) {
    throw new Error('Sign-in is not configured yet. Please try again later or contact the church office.');
  }
  const { data, error } = await supabase.auth.setSession({
    access_token: opts.access_token,
    refresh_token: opts.refresh_token,
  });
  if (error) {
    throw new Error(error.message || 'Could not start your session. Please try again.');
  }
  if (!data.session) {
    throw new Error('Could not start your session. Please try again.');
  }
  return data.session;
}

async function proxyAuthPhone(body: Record<string, unknown>): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  let res: Response;
  try {
    res = await fetch('/api/auth-phone', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Phone sign-in is temporarily unavailable. Please try again.');
  }

  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message =
      (typeof json?.message === 'string' && json.message) ||
      (typeof json?.error === 'string' && json.error) ||
      `Request failed (${res.status})`;
    throw toFriendlyPhoneAuthError(res.status, message);
  }

  const access_token = typeof json?.access_token === 'string' ? json.access_token : '';
  const refresh_token = typeof json?.refresh_token === 'string' ? json.refresh_token : '';
  if (!access_token || !refresh_token) {
    throw new Error('Could not start your session. Please try again.');
  }
  return { access_token, refresh_token };
}

/** Sign in with phone + password (Vault auth-phone bridge; no SMS). */
export async function signInWithPhonePassword(
  phone: string,
  password: string
): Promise<Session> {
  const json = await proxyAuthPhone({
    action: 'signin',
    phone: normalisePhone(phone),
    password,
  });
  return applySessionFromTokens(json);
}

/** Create an account with phone + password. Email is optional. */
export async function signUpWithPhone(opts: PhoneSignUpInput): Promise<Session> {
  const json = await proxyAuthPhone({
    action: 'signup',
    phone: normalisePhone(opts.phone),
    password: opts.password,
    first_name: opts.firstName.trim(),
    last_name: opts.lastName.trim(),
    email: (opts.email || '').trim(),
  });
  return applySessionFromTokens(json);
}

/** Text sign-in codes are on (Twilio Verify through the Vault). On by default; set VITE_SMS_SIGNIN_ENABLED=false to hide. */
export const SMS_SIGNIN_ENABLED = import.meta.env.VITE_SMS_SIGNIN_ENABLED !== 'false';

/**
 * Text a 6-digit code. "signin" answers the same whether or not an account uses
 * the number; "signup" says if the number is already taken.
 */
export async function requestPhoneCode(phone: string, purpose: 'signin' | 'signup'): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/auth-phone', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'code-request', purpose, phone: normalisePhone(phone) }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Text sign-in is temporarily unavailable. Please try again.');
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  const message =
    (typeof json?.message === 'string' && json.message) ||
    (typeof json?.error === 'string' && json.error) ||
    '';
  if (!res.ok) {
    if (res.status === 400) throw new Error('Enter a 10-digit US mobile number.');
    if (res.status === 409) throw new Error(message || 'An account already uses that number. Sign in instead.');
    if (res.status === 429) throw new Error(message || 'Too many codes requested. Wait an hour, then try again.');
    throw new Error(message || 'Text sign-in is not available right now. Use your email or password.');
  }
  return message || 'Code sent. Check your texts.';
}

/** Verify the texted code: signs in, or (with `signup`) creates the account. */
export async function signInWithPhoneCode(
  phone: string,
  code: string,
  signup?: { firstName: string; lastName: string; email?: string }
): Promise<Session> {
  let tokens: { access_token: string; refresh_token: string };
  try {
    tokens = await proxyAuthPhone({
      action: 'code-verify',
      purpose: signup ? 'signup' : 'signin',
      phone: normalisePhone(phone),
      code: String(code || '').replace(/\D/g, ''),
      ...(signup
        ? {
            first_name: signup.firstName.trim(),
            last_name: signup.lastName.trim(),
            email: (signup.email || '').trim(),
          }
        : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    // The password wording from the shared error mapper doesn't fit a code.
    if (/phone number or password is incorrect/i.test(msg)) {
      throw new Error('That code did not work. Check it, or request a new code.');
    }
    throw err;
  }
  return applySessionFromTokens(tokens);
}
