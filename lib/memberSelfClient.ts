import { getValidAccessToken, refreshAccessToken } from './authAccessToken';
import type { ConnectMemberIdentity, MemberSelfPatchAction } from './authTypes';

export type MemberSelfErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'identity_missing'
  | 'rate_limited'
  | 'vault_unavailable'
  | 'bridge_unconfigured'
  | 'invalid_upstream'
  | 'method_not_allowed'
  | 'unknown_action'
  | 'extra_fields'
  | 'invalid_body'
  | 'network'
  | 'malformed_response'
  | 'session_missing';

export class MemberSelfError extends Error {
  code: MemberSelfErrorCode;
  status: number;
  /** True when the Supabase session should be rechecked / user returned to sign-in. */
  sessionInvalid: boolean;

  constructor(code: MemberSelfErrorCode, message: string, status: number, sessionInvalid = false) {
    super(message);
    this.name = 'MemberSelfError';
    this.code = code;
    this.status = status;
    this.sessionInvalid = sessionInvalid;
  }
}

function isMediaNotice(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.acknowledgedAt === 'string' &&
    (m.version === null || typeof m.version === 'string')
  );
}

function isMemberIdentity(value: unknown): value is ConnectMemberIdentity {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    (m.name === null || typeof m.name === 'string') &&
    (m.email === null || typeof m.email === 'string') &&
    (m.avatarUrl === null || typeof m.avatarUrl === 'string') &&
    typeof m.role === 'string' &&
    (m.approvalStatus === 'approved' || m.approvalStatus === 'pending') &&
    isMediaNotice(m.mediaNotice)
  );
}

async function getAccessToken(): Promise<string | null> {
  return getValidAccessToken();
}

function throwFromResponse(res: Response, body: unknown, sessionInvalid = false): never {
  const code =
    body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
      ? String((body as { code: string }).code)
      : '';
  const message =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? String((body as { message: string }).message)
      : '';

  if (res.status === 401) {
    throw new MemberSelfError(
      'unauthorized',
      message || 'Please sign in again to continue.',
      401,
      sessionInvalid
    );
  }
  if (res.status === 403) {
    throw new MemberSelfError(
      'forbidden',
      message || 'You do not have permission to view this member profile.',
      403
    );
  }
  if (res.status === 404) {
    throw new MemberSelfError(
      'identity_missing',
      message || 'We could not find a connected PLCC member profile for this sign-in.',
      404
    );
  }
  if (res.status === 429) {
    throw new MemberSelfError(
      'rate_limited',
      message || 'Too many requests. Please wait a moment and try again.',
      429
    );
  }
  if (res.status === 503) {
    throw new MemberSelfError(
      'bridge_unconfigured',
      message || 'Member verification is not available right now. Please try again later.',
      503
    );
  }
  if (
    code === 'unknown_action' ||
    code === 'extra_fields' ||
    code === 'invalid_body' ||
    code === 'method_not_allowed'
  ) {
    throw new MemberSelfError(
      code as MemberSelfErrorCode,
      message || 'That request was not valid. Please try again.',
      res.status || 400
    );
  }
  if (res.status >= 500 || res.status === 502) {
    throw new MemberSelfError(
      'vault_unavailable',
      message || 'We could not verify your member access right now. Please try again.',
      res.status
    );
  }
  throw new MemberSelfError(
    'malformed_response',
    message || 'We could not verify your member access right now. Please try again.',
    res.status || 502
  );
}

/**
 * Fetch sanitized Vault identity via Connect same-origin bridge.
 * Never logs the access token.
 */
export async function fetchMemberSelf(): Promise<ConnectMemberIdentity> {
  const token = await getAccessToken();
  if (!token) {
    throw new MemberSelfError(
      'session_missing',
      'Please sign in again to continue.',
      401,
      true
    );
  }

  let res: Response;
  try {
    res = await fetch('/api/member-self', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    throw new MemberSelfError(
      'network',
      'We could not verify your member access right now. Please try again.',
      0
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        res = await fetch('/api/member-self', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${refreshed}`,
          },
          cache: 'no-store',
        });
        body = await res.json().catch(() => null);
      } catch {
        throw new MemberSelfError(
          'network',
          'We could not verify your member access right now. Please try again.',
          0
        );
      }
    }
    if (res.status === 401) {
      const again = await getAccessToken();
      throwFromResponse(res, body, !again);
    }
  }

  if (!res.ok) {
    throwFromResponse(res, body);
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !(body as { ok?: unknown }).ok ||
    !isMemberIdentity((body as { member?: unknown }).member)
  ) {
    throw new MemberSelfError(
      'malformed_response',
      'We could not verify your member access right now. Please try again.',
      res.status || 502
    );
  }

  return (body as { member: ConnectMemberIdentity }).member;
}

/**
 * Self-service PATCH: complete onboarding (auto-approve) or acknowledge media notice.
 */
export async function patchMemberSelf(
  action: MemberSelfPatchAction
): Promise<ConnectMemberIdentity> {
  const token = await getAccessToken();
  if (!token) {
    throw new MemberSelfError(
      'session_missing',
      'Please sign in again to continue.',
      401,
      true
    );
  }

  let res: Response;
  try {
    res = await fetch('/api/member-self', {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action }),
      cache: 'no-store',
    });
  } catch {
    throw new MemberSelfError(
      'network',
      'We could not update your member profile right now. Please try again.',
      0
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        res = await fetch('/api/member-self', {
          method: 'PATCH',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${refreshed}`,
          },
          body: JSON.stringify({ action }),
          cache: 'no-store',
        });
        body = await res.json().catch(() => null);
      } catch {
        throw new MemberSelfError(
          'network',
          'We could not update your member profile right now. Please try again.',
          0
        );
      }
    }
    if (res.status === 401) {
      const again = await getAccessToken();
      throwFromResponse(res, body, !again);
    }
  }

  if (!res.ok) {
    throwFromResponse(res, body);
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !(body as { ok?: unknown }).ok ||
    !isMemberIdentity((body as { member?: unknown }).member)
  ) {
    throw new MemberSelfError(
      'malformed_response',
      'We could not update your member profile right now. Please try again.',
      res.status || 502
    );
  }

  return (body as { member: ConnectMemberIdentity }).member;
}

export async function completeMemberOnboarding(): Promise<ConnectMemberIdentity> {
  return patchMemberSelf('complete_onboarding');
}

export async function acknowledgeMediaNotice(): Promise<ConnectMemberIdentity> {
  return patchMemberSelf('acknowledge_media_notice');
}
