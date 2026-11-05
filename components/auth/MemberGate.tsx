import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { rememberReturnTo, returnToFromLocation } from '../../lib/authReturnPath';
import type { MemberAccessState } from '../../lib/authTypes';
import { Loader2 } from 'lucide-react';

type GateRequirement =
  | 'authenticated'
  | 'approved_member';

interface MemberGateProps {
  children: React.ReactNode;
  /**
   * `authenticated` — any valid Supabase session (account area).
   * `approved_member` — Vault identity bridge confirmed an approved role.
   * Fail closed for private member areas. Never infer from Auth metadata.
   */
  requireAccess?: GateRequirement;
}

function GateMessage(props: {
  title: string;
  body: string;
  showRetry?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex-1 px-6 py-16 text-center space-y-4 max-w-md mx-auto">
      <h1 className="text-lg font-bold text-[#1A1A1A]">{props.title}</h1>
      <p className="text-sm text-gray-500 leading-relaxed">{props.body}</p>
      {props.showRetry && props.onRetry && (
        <button
          type="button"
          onClick={props.onRetry}
          className="min-h-[44px] px-5 rounded-2xl bg-burgundy text-white text-sm font-bold"
        >
          Try again
        </button>
      )}
      <div>
        <a href="/" className="inline-block text-burgundy font-bold text-sm underline min-h-[44px]">
          Back to PLCC Chat
        </a>
      </div>
    </div>
  );
}

function describeBlock(state: MemberAccessState): { title: string; body: string; retry?: boolean } {
  switch (state) {
    case 'pending':
      return {
        title: 'Awaiting approval',
        body: 'Your sign-in is working, but member features are not available until your PLCC account is approved.',
      };
    case 'identity_missing':
      return {
        title: 'Member profile not found',
        body: 'We could not find a connected PLCC member profile for this sign-in. Please contact church leadership if this continues.',
        retry: true,
      };
    case 'identity_unavailable':
      return {
        title: 'Verification unavailable',
        body: 'We could not verify your member access right now. Your sign-in is still active. Please try again.',
        retry: true,
      };
    case 'authenticated_unverified':
      return {
        title: 'Checking member access',
        body: 'Please wait while we verify your PLCC member profile.',
      };
    default:
      return {
        title: 'Member access required',
        body: 'Please sign in with an approved PLCC member account to continue.',
      };
  }
}

/**
 * Protects member-only routes. Do not wrap public visitor pages.
 * A valid session ≠ Vault-approved Community access.
 */
export const MemberGate: React.FC<MemberGateProps> = ({
  children,
  requireAccess = 'authenticated',
}) => {
  const {
    isLoading,
    isAuthenticated,
    isConfigured,
    memberAccessState,
    identityLoading,
    refreshIdentity,
  } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-24 min-h-[50vh]">
        <Loader2 className="animate-spin text-burgundy" size={32} aria-hidden />
        <p className="text-sm text-gray-500" role="status">
          Checking your sign-in…
        </p>
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <GateMessage
        title="Sign-in unavailable"
        body="Member sign-in is not configured on this device yet."
      />
    );
  }

  if (!isAuthenticated) {
    const returnTo = returnToFromLocation(location);
    rememberReturnTo(returnTo);
    return <Navigate to="/sign-in" replace state={{ returnTo }} />;
  }

  if (requireAccess === 'authenticated') {
    return <>{children}</>;
  }

  // approved_member — fail closed while verifying or if not approved
  if (identityLoading || memberAccessState === 'authenticated_unverified') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-24 min-h-[50vh]">
        <Loader2 className="animate-spin text-burgundy" size={32} aria-hidden />
        <p className="text-sm text-gray-500" role="status">
          Verifying member access…
        </p>
      </div>
    );
  }

  if (memberAccessState === 'approved_member') {
    return <>{children}</>;
  }

  const block = describeBlock(memberAccessState);
  return (
    <GateMessage
      title={block.title}
      body={block.body}
      showRetry={block.retry}
      onRetry={() => void refreshIdentity()}
    />
  );
};
