import { inputClass, LABEL_CLASS } from '../components/ui/Field';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Phone, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isValidEmail } from '../lib/authOtp';
import {
  isPhoneNumber,
  normalisePhone,
  requestPhoneCode,
  SMS_SIGNIN_ENABLED,
} from '../lib/authPhoneClient';
import {
  goToReturnPath,
  rememberReturnTo,
  sanitizeReturnTo,
} from '../lib/authReturnPath';
import { AWCLogo } from '../components/ui/AWCLogo';
import { Button } from '../components/ui/Button';

type Stage = 'identifier' | 'otp' | 'phone_password' | 'phone_signup' | 'phone_code' | 'success';

export const MemberSignIn: React.FC = () => {
  const {
    signInWithOtp,
    verifyOtp,
    signInWithPhone,
    signUpWithPhonePassword,
    signInWithPhoneCode,
    isAuthenticated,
    isConfigured,
    isLoading,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const identifierId = useId();
  const otpId = useId();
  const passwordId = useId();
  const firstNameId = useId();
  const lastNameId = useId();
  const optionalEmailId = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Signing in fires both the auth listener and the form handler; leave only once,
  // or the second exit overwrites the first (e.g. PLCC Ark → My Account).
  const leftRef = useRef(false);
  const leave = () => {
    if (leftRef.current) return;
    leftRef.current = true;
    goToReturnPath(navigate, '/account');
  };

  const [stage, setStage] = useState<Stage>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [optionalEmail, setOptionalEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [codePurpose, setCodePurpose] = useState<'signin' | 'signup'>('signin');
  const [codeNotice, setCodeNotice] = useState('');
  const phoneCodeId = useId();

  const intent =
    (location.state as { intent?: string } | null)?.intent === 'join' ? 'join' : 'signin';
  const isJoin = intent === 'join';
  const usingPhone = isPhoneNumber(identifier);

  useEffect(() => {
    const fromState = (location.state as { returnTo?: string } | null)?.returnTo;
    const fromQuery = searchParams.get('returnTo');
    const safe = sanitizeReturnTo(fromState || fromQuery);
    if (safe) rememberReturnTo(safe);
  }, [location.state, searchParams]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      leave();
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleIdentifierContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');

    const raw = identifier.trim();
    if (!raw) {
      setError('Enter your email or mobile number.');
      return;
    }
    if (isJoin && (!firstName.trim() || !lastName.trim())) {
      setError('First and last name are required.');
      return;
    }

    if (isPhoneNumber(raw)) {
      setIdentifier(normalisePhone(raw));
      setStage(isJoin ? 'phone_signup' : 'phone_password');
      setPassword('');
      return;
    }

    if (!isValidEmail(raw)) {
      setError('Please enter a valid email address or mobile number.');
      return;
    }

    setSubmitting(true);
    try {
      await signInWithOtp(
        raw,
        isJoin ? { firstName: firstName.trim(), lastName: lastName.trim() } : undefined
      );
      setStage('otp');
      setOtp('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send a sign-in code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await verifyOtp(identifier, otp);
      setStage('success');
      leave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify that code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePhoneSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await signInWithPhone(identifier, password);
      setStage('success');
      leave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with that phone number.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePhoneSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (!firstName.trim() || !lastName.trim()) {
      setError('Enter your first and last name.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (optionalEmail.trim() && !isValidEmail(optionalEmail)) {
      setError('Please enter a valid email address, or leave it blank.');
      return;
    }
    setSubmitting(true);
    try {
      await signUpWithPhonePassword({
        phone: identifier,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: optionalEmail.trim() || undefined,
      });
      setStage('success');
      leave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  /** Text a code to the number on screen (sign in, or finish a new account). */
  const startPhoneCode = async (purpose: 'signin' | 'signup') => {
    if (submitting) return;
    setError('');
    if (purpose === 'signup' && (!firstName.trim() || !lastName.trim())) {
      setError('Enter your first and last name.');
      return;
    }
    if (purpose === 'signup' && optionalEmail.trim() && !isValidEmail(optionalEmail)) {
      setError('Please enter a valid email address, or leave it blank.');
      return;
    }
    setSubmitting(true);
    try {
      const message = await requestPhoneCode(identifier, purpose);
      setCodePurpose(purpose);
      setCodeNotice(message);
      setPhoneCode('');
      setStage('phone_code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send a code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePhoneCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (phoneCode.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code from your text.');
      return;
    }
    setSubmitting(true);
    try {
      await signInWithPhoneCode(
        identifier,
        phoneCode,
        codePurpose === 'signup'
          ? {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: optionalEmail.trim() || undefined,
            }
          : undefined
      );
      setStage('success');
      leave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify that code.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-24 px-6">
        <p className="text-sm text-gray-500" role="status">
          Checking your sign-in…
        </p>
      </div>
    );
  }

  return (
    <main className="flex-1 px-5 pt-10 pb-28 flex flex-col">
      <div className="flex flex-col items-center text-center mt-4 mb-8">
        <AWCLogo src="/awc_chat_logo.png" size={112} className="mb-4 drop-shadow-sm" />
        <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">
          {isJoin ? 'Create your account' : 'Member Sign In'}
        </h1>
        <p className="text-sm text-gray-500 mt-2 max-w-sm leading-relaxed">
          {isJoin
            ? 'First and last name are required. Then use your email or mobile number.'
            : 'Sign in with the email or mobile number on your PLCC account.'}
        </p>
        {!isJoin ? (
          <Link
            to="/sign-in"
            state={{
              intent: 'join',
              returnTo: (location.state as { returnTo?: string } | null)?.returnTo,
            }}
            className="mt-3 text-[13px] font-bold text-burgundy min-h-[44px] inline-flex items-center"
          >
            New to PLCC? Create an account
          </Link>
        ) : (
          <Link
            to="/sign-in"
            state={{
              intent: 'signin',
              returnTo: (location.state as { returnTo?: string } | null)?.returnTo,
            }}
            className="mt-3 text-[13px] font-bold text-burgundy min-h-[44px] inline-flex items-center"
          >
            Already have an account? Sign in
          </Link>
        )}
      </div>

      {!isConfigured && (
        <div
          className="bg-white border border-gold/30 rounded-2xl p-4 text-sm text-gray-600 mb-4"
          role="alert"
        >
          Member sign-in is not configured on this deployment yet.
        </div>
      )}

      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mb-4 bg-red-50 text-red-800 text-sm rounded-2xl px-4 py-3 border border-red-100 outline-none"
        >
          {error}
        </p>
      )}

      {stage === 'identifier' && (
        <form
          onSubmit={(e) => void handleIdentifierContinue(e)}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4"
        >
          {isJoin && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label
                  htmlFor={firstNameId}
                  className={LABEL_CLASS}
                >
                  First name (Required)
                </label>
                <input
                  id={firstNameId}
                  type="text"
                  autoComplete="given-name"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={submitting || !isConfigured}
                  className={inputClass()}
                  placeholder="Jordan"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor={lastNameId}
                  className={LABEL_CLASS}
                >
                  Last name (Required)
                </label>
                <input
                  id={lastNameId}
                  type="text"
                  autoComplete="family-name"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={submitting || !isConfigured}
                  className={inputClass()}
                  placeholder="Smith"
                />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <label
              htmlFor={identifierId}
              className={LABEL_CLASS}
            >
              Email or mobile number
            </label>
            <div className="relative">
              {usingPhone ? (
                <Phone
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                  aria-hidden
                />
              ) : (
                <Mail
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                  aria-hidden
                />
              )}
              <input
                id={identifierId}
                type="text"
                name="identifier"
                autoComplete="username"
                inputMode="email"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={submitting || !isConfigured}
                className={inputClass({ className: 'pl-10 pr-4' })}
                placeholder="you@example.com or (555) 123-4567"
              />
            </div>
          </div>

          <Button
            type="submit"
            fullWidth
            disabled={
              submitting ||
              !isConfigured ||
              (isJoin && (!firstName.trim() || !lastName.trim()))
            }
            className="min-h-[52px]"
            data-signin-continue
          >
            {submitting ? (
              <span role="status">Continuing…</span>
            ) : isJoin ? (
              'Continue'
            ) : (
              'Continue'
            )}
          </Button>

          <p className="text-xs text-gray-500 leading-relaxed text-center px-2">
            Email: we send you a one-time code. Phone: use your account password. Same account
            as PLCC Connect and the Vault.
          </p>
          <p className="text-sm text-center">
            <a href="https://plcc-connect.vercel.app/" className="font-bold text-burgundy underline">
              Go to PLCC Connect
            </a>
            <span className="text-gray-400 mx-2">·</span>
            <a href="https://plcc-opal.vercel.app/" className="font-bold text-burgundy underline">
              Go to the Vault
            </a>
          </p>
        </form>
      )}

      {stage === 'otp' && (
        <form
          onSubmit={(e) => void handleVerify(e)}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4"
        >
          <div className="flex items-start gap-3 bg-burgundy/5 rounded-2xl p-3">
            <ShieldCheck className="text-burgundy shrink-0 mt-0.5" size={20} aria-hidden />
            <p className="text-sm text-gray-600 leading-relaxed text-left">
              If an account can receive mail at{' '}
              <span className="font-semibold text-[#1A1A1A]">{identifier.trim()}</span>, check your
              inbox (and spam folder) for a 6-digit code. Links in the email also work.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={otpId}
              className={LABEL_CLASS}
            >
              Sign-in code
            </label>
            <input
              id={otpId}
              type="text"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              disabled={submitting}
              className={inputClass({ className: 'px-4 text-center text-2xl tracking-[0.35em] font-bold' })}
              placeholder="••••••"
              aria-describedby={`${otpId}-hint`}
            />
            <p id={`${otpId}-hint`} className="text-xs text-gray-500 text-center">
              Enter the code from your email
            </p>
          </div>

          <Button
            type="submit"
            fullWidth
            disabled={submitting || otp.length < 6}
            className="min-h-[52px]"
            data-signin-email-otp
          >
            {submitting ? <span role="status">Verifying…</span> : 'Verify & Sign In'}
          </Button>

          <button
            type="button"
            className="w-full min-h-[44px] text-sm font-bold text-burgundy disabled:opacity-50"
            disabled={submitting}
            onClick={() => {
              setStage('identifier');
              setOtp('');
              setError('');
            }}
          >
            Use a different email or phone
          </button>

          <button
            type="button"
            className="w-full min-h-[44px] text-xs font-semibold text-gray-500 disabled:opacity-50"
            disabled={submitting}
            onClick={async () => {
              setError('');
              setSubmitting(true);
              try {
                await signInWithOtp(
                  identifier,
                  isJoin
                    ? { firstName: firstName.trim(), lastName: lastName.trim() }
                    : undefined
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Unable to resend code.');
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Resend code
          </button>
        </form>
      )}

      {stage === 'phone_code' && (
        <form
          onSubmit={(e) => void handlePhoneCode(e)}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4"
          data-signin-phone-code
        >
          <p className="text-sm text-gray-600 leading-relaxed">
            Enter the 6-digit code texted to{' '}
            <span className="font-semibold text-[#1A1A1A]">{identifier}</span>.
          </p>
          {codePurpose === 'signin' && codeNotice ? (
            <p className="text-xs text-gray-500 leading-relaxed" role="status">
              {codeNotice} No account yet? Go back and choose Join.
            </p>
          ) : null}
          <div className="space-y-2">
            <label htmlFor={phoneCodeId} className={LABEL_CLASS}>
              6-digit code
            </label>
            <input
              id={phoneCodeId}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={phoneCode}
              onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={submitting}
              className={inputClass({ className: 'tracking-[0.3em] font-mono text-center' })}
              placeholder="000000"
            />
          </div>
          <Button
            type="submit"
            fullWidth
            disabled={submitting || phoneCode.length !== 6}
            className="min-h-[52px]"
          >
            {submitting ? (
              <span role="status">Checking…</span>
            ) : codePurpose === 'signup' ? (
              'Create account'
            ) : (
              'Sign In'
            )}
          </Button>
          <button
            type="button"
            className="w-full min-h-[44px] text-xs font-semibold text-gray-500 disabled:opacity-50"
            disabled={submitting}
            onClick={() => void startPhoneCode(codePurpose)}
          >
            Resend code
          </button>
          <button
            type="button"
            className="w-full min-h-[44px] text-sm font-bold text-burgundy disabled:opacity-50"
            disabled={submitting}
            onClick={() => {
              setStage(codePurpose === 'signup' ? 'phone_signup' : 'phone_password');
              setPhoneCode('');
              setError('');
            }}
          >
            {codePurpose === 'signup' ? 'Back' : 'Use my password instead'}
          </button>
        </form>
      )}

      {stage === 'phone_password' && (
        <form
          onSubmit={(e) => void handlePhoneSignIn(e)}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4"
          data-signin-phone-password
        >
          <p className="text-sm text-gray-600 leading-relaxed">
            Enter the password for{' '}
            <span className="font-semibold text-[#1A1A1A]">{identifier}</span>.
          </p>
          <div className="space-y-2">
            <label
              htmlFor={passwordId}
              className={LABEL_CLASS}
            >
              Password
            </label>
            <input
              id={passwordId}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className={inputClass()}
              placeholder="Your password"
            />
          </div>
          <Button
            type="submit"
            fullWidth
            disabled={submitting || password.length < 6}
            className="min-h-[52px]"
          >
            {submitting ? <span role="status">Signing in…</span> : 'Sign In'}
          </Button>
          {SMS_SIGNIN_ENABLED && (
            <button
              type="button"
              className="w-full min-h-[52px] rounded-2xl border-2 border-burgundy text-base font-bold text-burgundy flex items-center justify-center gap-2 hover:bg-burgundy/5 active:scale-[0.98] transition-all disabled:opacity-50"
              disabled={submitting}
              onClick={() => void startPhoneCode('signin')}
              data-signin-text-code
            >
              <Phone className="w-5 h-5" aria-hidden="true" /> Text me a code instead
            </button>
          )}
          <button
            type="button"
            className="w-full min-h-[44px] text-sm font-bold text-burgundy disabled:opacity-50"
            disabled={submitting}
            onClick={() => {
              setStage('identifier');
              setPassword('');
              setError('');
            }}
          >
            Use a different email or phone
          </button>
        </form>
      )}

      {stage === 'phone_signup' && (
        <form
          onSubmit={(e) => void handlePhoneSignUp(e)}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4"
          data-signin-phone-signup
        >
          <p className="text-sm text-gray-600 leading-relaxed">
            Creating an account for{' '}
            <span className="font-semibold text-[#1A1A1A]">{identifier}</span> with a password.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label
                htmlFor={firstNameId}
                className={LABEL_CLASS}
              >
                First name (Required)
              </label>
              <input
                id={firstNameId}
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={submitting}
                className={inputClass({ size: 'sm', className: 'px-3' })}
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor={lastNameId}
                className={LABEL_CLASS}
              >
                Last name (Required)
              </label>
              <input
                id={lastNameId}
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={submitting}
                className={inputClass({ size: 'sm', className: 'px-3' })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label
              htmlFor={passwordId}
              className={LABEL_CLASS}
            >
              Password
            </label>
            <input
              id={passwordId}
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className={inputClass()}
              placeholder="At least 6 characters"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor={optionalEmailId}
              className={LABEL_CLASS}
            >
              Email (optional)
            </label>
            <input
              id={optionalEmailId}
              type="email"
              autoComplete="email"
              value={optionalEmail}
              onChange={(e) => setOptionalEmail(e.target.value)}
              disabled={submitting}
              className={inputClass({ size: 'sm' })}
              placeholder="you@example.com"
            />
          </div>
          <Button
            type="submit"
            fullWidth
            disabled={
              submitting || password.length < 6 || !firstName.trim() || !lastName.trim()
            }
            className="min-h-[52px]"
          >
            {submitting ? <span role="status">Creating account…</span> : 'Create account'}
          </Button>
          {SMS_SIGNIN_ENABLED && (
            <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50 p-3">
              <button
                type="button"
                className="w-full min-h-[52px] rounded-2xl border-2 border-burgundy bg-white text-base font-bold text-burgundy flex items-center justify-center gap-2 hover:bg-burgundy/5 active:scale-[0.98] transition-all disabled:opacity-50"
                disabled={submitting || !firstName.trim() || !lastName.trim()}
                onClick={() => void startPhoneCode('signup')}
                data-signup-text-code
              >
                <Phone className="w-5 h-5" aria-hidden="true" /> No password? Text me a code
              </button>
              <p className="text-[11px] leading-relaxed text-gray-500 text-center">
                We'll text one 6-digit code to {identifier} to finish your account. Msg &amp; data rates
                may apply. Reply STOP to opt out.
              </p>
            </div>
          )}
          <button
            type="button"
            className="w-full min-h-[44px] text-sm font-bold text-burgundy disabled:opacity-50"
            disabled={submitting}
            onClick={() => {
              setStage('identifier');
              setPassword('');
              setError('');
            }}
          >
            Use a different email or phone
          </button>
        </form>
      )}
    </main>
  );
};
