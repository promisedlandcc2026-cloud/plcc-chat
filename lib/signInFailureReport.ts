/**
 * Phase 4 (#17): tell the church who is failing to sign in, and why.
 *
 * The church server already records phone/password failures. This reports the
 * ones it can't see: email-code problems, numbers typed wrong, the server being
 * unreachable, and "signed in but not approved / no member profile".
 * If the report itself can't be sent (no network), it waits on the phone and is
 * sent next time. Never sends passwords or codes.
 */

export type SignInFailureReason =
  | 'invalid_phone'
  | 'server_unreachable'
  | 'email_code_not_sent'
  | 'email_code_wrong'
  | 'member_pending'
  | 'member_not_found'
  | 'member_check_failed';

type Report = {
  method: 'phone' | 'email' | 'session';
  identifier: string;
  reason: SignInFailureReason;
  detail?: string;
  at?: number;
};

const QUEUE_KEY = 'plcc_signin_failures_v1';
const MAX_QUEUE = 10;

function readQueue(): Report[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(v) ? v.slice(-MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: Report[]) {
  try {
    if (q.length) window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
    else window.localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* private mode */
  }
}

async function send(r: Report): Promise<boolean> {
  try {
    const res = await fetch('/api/auth-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'report-failure',
        app: 'ka-link',
        method: r.method,
        identifier: String(r.identifier || '').slice(0, 120),
        reason: r.reason,
        detail: r.detail ? String(r.detail).slice(0, 200) : undefined,
        at: r.at,
      }),
      keepalive: true,
    });
    // 4xx means the server read it and said no (e.g. rate limited) — don't keep retrying.
    return res.ok || (res.status >= 400 && res.status < 500);
  } catch {
    return false;
  }
}

export async function reportSignInFailure(r: Report): Promise<void> {
  if (typeof window === 'undefined') return;
  const item = { ...r, at: r.at ?? Date.now() };
  if (!(await send(item))) writeQueue([...readQueue(), item]);
  else void flushSignInFailureReports();
}

/** Once per page load per reason — for session checks that repeat on every render. */
const reportedOnce = new Set<string>();
export function reportSignInFailureOnce(r: Report): void {
  const key = `${r.reason}:${r.identifier}`;
  if (reportedOnce.has(key)) return;
  reportedOnce.add(key);
  void reportSignInFailure(r);
}

let flushing = false;
export async function flushSignInFailureReports(): Promise<void> {
  if (flushing || typeof window === 'undefined') return;
  const q = readQueue();
  if (!q.length) return;
  flushing = true;
  try {
    const left: Report[] = [];
    for (const r of q) if (!(await send(r))) left.push(r);
    writeQueue(left);
  } finally {
    flushing = false;
  }
}
