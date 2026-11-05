const RETURN_TO_KEY = 'awc_chat_auth_return_to';

/**
 * Internal Connect paths only. Rejects protocol-relative and absolute URLs.
 * Mirrors Vault's sanitizeReturnTo safety rules for a separate origin.
 */
export function sanitizeReturnTo(raw: unknown): string | null {
  if (raw == null) return null;
  let path = String(raw).trim();
  if (!path) return null;

  if (path.startsWith('#/')) path = path.slice(1);
  if (path.startsWith('#')) path = path.slice(1);
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return null;
  if (path.includes('://')) return null;

  const pathname = path.split('?')[0] || '/';
  if (
    pathname === '/sign-in' ||
    pathname.startsWith('/sign-in/') ||
    pathname === '/auth/callback' ||
    pathname.startsWith('/auth/')
  ) {
    return null;
  }

  if (!/^\/[A-Za-z0-9\-._~/?&=%]*$/.test(path)) return null;
  return path;
}

export function rememberReturnTo(path: string | null): void {
  const safe = sanitizeReturnTo(path);
  try {
    if (safe) sessionStorage.setItem(RETURN_TO_KEY, safe);
    else sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    /* private mode / quota */
  }
}

export function peekReturnTo(): string | null {
  try {
    return sanitizeReturnTo(sessionStorage.getItem(RETURN_TO_KEY));
  } catch {
    return null;
  }
}

export function consumeReturnTo(fallback = '/account'): string {
  try {
    const raw = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return sanitizeReturnTo(raw) || fallback;
  } catch {
    return fallback;
  }
}

/** Build a safe return path from the current React Router location. */
export function returnToFromLocation(from: {
  pathname?: string | null;
  search?: string | null;
} | null | undefined): string | null {
  if (!from) return null;
  const pathname = String(from.pathname || '').trim();
  if (!pathname) return null;
  const rawSearch = String(from.search || '').trim();
  const search = !rawSearch
    ? ''
    : rawSearch.startsWith('?')
      ? rawSearch
      : `?${rawSearch}`;
  return sanitizeReturnTo(`${pathname}${search}`);
}

/** Paths served by a separate site behind a Connect rewrite (PLCC Ark) need a full page load. */
export function needsFullPageLoad(path: string): boolean {
  return path === '/ark' || path.startsWith('/ark/') || path.startsWith('/ark?');
}

/** Leave the sign-in screen for the saved return path (or the fallback). */
export function goToReturnPath(
  navigate: (to: string, opts?: { replace?: boolean }) => void,
  fallback = '/account'
): void {
  const path = consumeReturnTo(fallback);
  if (needsFullPageLoad(path)) {
    window.location.replace(path);
    return;
  }
  navigate(path, { replace: true });
}
