/**
 * Is a failed sign-in check "this login is invalid" or just "the server didn't answer"?
 * Only the first may sign a member out. (Nov 27, 2026: during a database outage the
 * server answered with timeouts / Cloudflare 52x, members were signed out, and their
 * Ka Link calls ended with them.)
 */
const FATAL_HINTS = ['refresh_token_not_found', 'invalid_grant', 'session_not_found', 'invalid refresh token', 'refresh token not found', 'already used'];

export function classifyAuthFailure(
  error: { code?: string; message?: string; status?: number } | null | undefined
): 'invalid' | 'unreachable' {
  if (!error) return 'unreachable';
  const hay = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  if (FATAL_HINTS.some((h) => hay.includes(h))) return 'invalid';
  const status = Number(error.status || 0);
  return status >= 400 && status < 404 ? 'invalid' : 'unreachable';
}
