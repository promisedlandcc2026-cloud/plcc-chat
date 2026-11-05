/**
 * Browser-side types for the Connect member identity bridge.
 * Must stay aligned with api/_utils/memberIdentity.js sanitizer output.
 */

export type ApprovalStatus = 'approved' | 'pending';

/** Photography & media notice acknowledgement (from Vault notification_prefs). */
export type MediaNoticeAck = {
  acknowledgedAt: string;
  version: string | null;
};

export type ConnectMemberIdentity = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  approvalStatus: ApprovalStatus;
  /** Null when the member has not acknowledged the current media notice. */
  mediaNotice: MediaNoticeAck | null;
};

/** Must match api/_utils/memberIdentity.js MEDIA_NOTICE_VERSION */
export const MEDIA_NOTICE_VERSION = 'awc-media-notice-v1';

export type MemberSelfPatchAction =
  | 'complete_onboarding'
  | 'acknowledge_media_notice';

/**
 * Member access after Auth + Vault identity bridge.
 * Never infer these from Supabase Auth metadata alone.
 */
export type MemberAccessState =
  | 'visitor'
  | 'authenticated_unverified'
  | 'pending'
  | 'approved_member'
  | 'identity_missing'
  | 'identity_unavailable';

/** @deprecated Prefer MemberAccessState — kept for Phase 1 compatibility aliases */
export type AuthAccessLevel =
  | 'visitor'
  | 'authenticated'
  | 'application_verified'
  | 'member_feature_authorized';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in' | 'error';

export function memberAccessFromIdentity(opts: {
  isAuthenticated: boolean;
  identityLoading: boolean;
  identity: ConnectMemberIdentity | null;
  identityErrorCode: string | null;
}): MemberAccessState {
  if (!opts.isAuthenticated) return 'visitor';
  if (opts.identityLoading && !opts.identity) return 'authenticated_unverified';
  if (opts.identity) {
    return opts.identity.approvalStatus === 'approved' ? 'approved_member' : 'pending';
  }
  if (opts.identityErrorCode === 'identity_missing') return 'identity_missing';
  if (opts.identityErrorCode) return 'identity_unavailable';
  return 'authenticated_unverified';
}

/** Map MemberAccessState onto the Phase 1 AuthAccessLevel labels for gates. */
export function authAccessLevelFromMemberState(state: MemberAccessState): AuthAccessLevel {
  switch (state) {
    case 'visitor':
      return 'visitor';
    case 'approved_member':
      return 'member_feature_authorized';
    case 'pending':
      return 'application_verified';
    default:
      return 'authenticated';
  }
}
