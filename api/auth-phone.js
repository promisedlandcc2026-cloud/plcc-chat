import {
  buildVaultAuthPhoneCodeUrl,
  buildVaultAuthPhoneUrl,
  parseVaultApiOrigin,
} from './_utils/vaultOrigin.js';

const UPSTREAM_TIMEOUT_MS = 12000;
const MAX_BODY_BYTES = 4096;

function setNoStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
}

function json(res, status, body) {
  setNoStore(res);
  res.status(status).json(body);
}

/**
 * Narrow same-origin bridge:
 * POST /api/auth-phone → Vault POST /api/vault?resource=auth-phone
 *   actions signin / signup (phone + password)
 * POST /api/auth-phone → Vault POST /api/vault?resource=auth-phone-code
 *   actions code-request / code-verify (texted code, sign in or sign up)
 *   actions link-request / link-verify / link-status / unlink — SIGNED IN member turns
 *     text sign-in on or off for their own account (their Bearer token is passed on)
 *
 * Fixed upstream. No browser-controlled host/resource.
 * Never logs passwords or session tokens.
 */
export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, {
      ok: false,
      code: 'method_not_allowed',
      message: 'This endpoint only supports POST.',
    });
  }

  const allowHttpLocal = process.env.NODE_ENV !== 'production';
  const originResult = parseVaultApiOrigin(process.env.VAULT_API_ORIGIN, {
    allowHttpLocal,
  });
  if (!originResult.ok) {
    console.error('[auth-phone] VAULT_API_ORIGIN invalid:', originResult.reason);
    return json(res, 503, {
      ok: false,
      code: 'bridge_unconfigured',
      message: 'Phone sign-in is not available right now. Please try again later.',
    });
  }

  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return json(res, 415, {
      ok: false,
      code: 'invalid_content_type',
      message: 'That request was not valid. Please try again.',
    });
  }

  let rawBody = req.body;
  if (typeof rawBody === 'string') {
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return json(res, 413, {
        ok: false,
        code: 'body_too_large',
        message: 'That request was not valid. Please try again.',
      });
    }
    try {
      rawBody = JSON.parse(rawBody);
    } catch {
      return json(res, 400, {
        ok: false,
        code: 'invalid_body',
        message: 'That request was not valid. Please try again.',
      });
    }
  } else if (rawBody == null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return json(res, 400, {
      ok: false,
      code: 'invalid_body',
      message: 'That request was not valid. Please try again.',
    });
  } else {
    try {
      const encoded = JSON.stringify(rawBody);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_BODY_BYTES) {
        return json(res, 413, {
          ok: false,
          code: 'body_too_large',
          message: 'That request was not valid. Please try again.',
        });
      }
    } catch {
      return json(res, 400, {
        ok: false,
        code: 'invalid_body',
        message: 'That request was not valid. Please try again.',
      });
    }
  }

  /** @type {Record<string, unknown>} */
  const body = rawBody;
  const action = String(body.action || '')
    .trim()
    .toLowerCase();
  const isCode = action === 'code-request' || action === 'code-verify';
  const isLink = ['link-request', 'link-verify', 'link-status', 'unlink'].includes(action);
  const authHeader = String(req.headers?.authorization || '');
  if (isLink && !/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(authHeader)) {
    return json(res, 401, { ok: false, code: 'auth_required', message: 'Please sign in first.', error: 'Please sign in first.' });
  }
  if (action !== 'signin' && action !== 'signup' && !isCode && !isLink) {
    return json(res, 400, {
      ok: false,
      code: 'unknown_action',
      message: 'That request was not valid. Please try again.',
    });
  }

  const purpose = String(body.purpose || '').toLowerCase() === 'signup' ? 'signup' : 'signin';
  const upstreamBody = isLink
    ? {
        action,
        ...(action === 'link-request' || action === 'link-verify' ? { phone: body.phone } : {}),
        ...(action === 'link-verify' ? { code: body.code } : {}),
      }
    : isCode
    ? {
        action: action === 'code-request' ? 'request' : 'verify',
        purpose,
        phone: body.phone,
        ...(action === 'code-verify' ? { code: body.code } : {}),
        ...(action === 'code-verify' && purpose === 'signup'
          ? {
              first_name: body.first_name,
              last_name: body.last_name,
              email: body.email || '',
            }
          : {}),
      }
    : {
        action,
        phone: body.phone,
        password: body.password,
        ...(action === 'signup'
          ? {
              first_name: body.first_name,
              last_name: body.last_name,
              email: body.email || '',
            }
          : {}),
      };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamUrl = isCode || isLink
      ? buildVaultAuthPhoneCodeUrl(originResult.origin)
      : buildVaultAuthPhoneUrl(originResult.origin);
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(isLink ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
      redirect: 'error',
    });

    let upstreamJson = null;
    try {
      upstreamJson = await upstream.json();
    } catch {
      upstreamJson = null;
    }

    if (!upstream.ok) {
      const message =
        (upstreamJson && typeof upstreamJson.error === 'string' && upstreamJson.error) ||
        (upstreamJson && typeof upstreamJson.message === 'string' && upstreamJson.message) ||
        'Phone sign-in failed. Please try again.';
      return json(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        ok: false,
        code: upstream.status === 429 ? 'rate_limited' : 'auth_failed',
        message,
        error: message,
      });
    }

    // Turning text sign-in on/off: status only (masked number), never a session.
    if (isLink) {
      return json(res, 200, {
        ok: true,
        enabled: Boolean(upstreamJson?.enabled),
        phone: upstreamJson && typeof upstreamJson.phone === 'string' ? upstreamJson.phone : null,
        message: upstreamJson && typeof upstreamJson.message === 'string' ? upstreamJson.message : undefined,
      });
    }

    // A code request returns only a status message (no session).
    if (action === 'code-request') {
      return json(res, 200, {
        ok: true,
        message:
          upstreamJson && typeof upstreamJson.message === 'string'
            ? upstreamJson.message
            : 'Code sent. Check your texts.',
      });
    }

    const access_token =
      upstreamJson && typeof upstreamJson.access_token === 'string'
        ? upstreamJson.access_token
        : '';
    const refresh_token =
      upstreamJson && typeof upstreamJson.refresh_token === 'string'
        ? upstreamJson.refresh_token
        : '';

    if (!access_token || !refresh_token) {
      console.error('[auth-phone] upstream missing tokens');
      return json(res, 502, {
        ok: false,
        code: 'invalid_upstream',
        message: 'Phone sign-in is temporarily unavailable. Please try again.',
      });
    }

    // Pass through only the session fields Connect needs — never log them.
    return json(res, 200, {
      ok: true,
      access_token,
      refresh_token,
      expires_in:
        upstreamJson && typeof upstreamJson.expires_in === 'number'
          ? upstreamJson.expires_in
          : undefined,
      token_type:
        upstreamJson && typeof upstreamJson.token_type === 'string'
          ? upstreamJson.token_type
          : 'bearer',
      user: upstreamJson?.user && typeof upstreamJson.user === 'object' ? upstreamJson.user : null,
    });
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    console.error('[auth-phone] upstream error:', aborted ? 'timeout' : 'network');
    return json(res, 502, {
      ok: false,
      code: 'vault_unavailable',
      message: 'Phone sign-in is temporarily unavailable. Please try again.',
    });
  } finally {
    clearTimeout(timer);
  }
}
