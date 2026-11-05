import {
  MAX_MEMBER_SELF_PATCH_BODY_BYTES,
  asPrefsObject,
  buildMergedPrefsForAction,
  parseBearerAuthorization,
  parseMemberSelfPatchCommand,
  parseVaultSelfUserResponse,
  parseVaultUserPatchResponse,
} from './_utils/memberIdentity.js';
import {
  buildVaultSelfUserUrl,
  buildVaultUsersPatchUrl,
  parseVaultApiOrigin,
} from './_utils/vaultOrigin.js';

const UPSTREAM_TIMEOUT_MS = 8000;

function setNoStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
}

function json(res, status, body) {
  setNoStore(res);
  res.status(status).json(body);
}

function mapUpstreamError(res, status) {
  if (status === 401) {
    return json(res, 401, {
      ok: false,
      code: 'unauthorized',
      message: 'Please sign in again to continue.',
    });
  }
  if (status === 403) {
    return json(res, 403, {
      ok: false,
      code: 'forbidden',
      message: 'You do not have permission to update this member profile.',
    });
  }
  if (status === 404) {
    return json(res, 404, {
      ok: false,
      code: 'identity_missing',
      message: 'We could not find a connected PLCC member profile for this sign-in.',
    });
  }
  if (status === 429) {
    return json(res, 429, {
      ok: false,
      code: 'rate_limited',
      message: 'Too many requests. Please wait a moment and try again.',
    });
  }
  console.error('[member-self] upstream status', status);
  return json(res, 502, {
    ok: false,
    code: 'vault_unavailable',
    message: 'We could not verify your member access right now. Please try again.',
  });
}

/**
 * @param {string} token
 * @param {string} origin
 * @param {AbortSignal} signal
 */
async function fetchSelfUserRow(token, origin, signal) {
  const upstream = await fetch(buildVaultSelfUserUrl(origin), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal,
    redirect: 'error',
  });
  return upstream;
}

/**
 * Narrow same-origin bridge:
 * GET  /api/member-self → Vault GET  /api/vault?resource=users&self=true
 * PATCH /api/member-self → Vault GET self + PATCH /api/vault?resource=users
 *   (actions: complete_onboarding | acknowledge_media_notice only)
 *
 * Fixed upstream. No browser-controlled host/resource/method.
 * Never logs Authorization tokens.
 */
export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return json(res, 405, {
      ok: false,
      code: 'method_not_allowed',
      message: 'This endpoint only supports GET and PATCH.',
    });
  }

  const auth = parseBearerAuthorization(req.headers?.authorization);
  if (!auth.ok) {
    return json(res, 401, {
      ok: false,
      code: 'unauthorized',
      message: 'Please sign in again to continue.',
    });
  }

  const allowHttpLocal = process.env.NODE_ENV !== 'production';
  const originResult = parseVaultApiOrigin(process.env.VAULT_API_ORIGIN, {
    allowHttpLocal,
  });
  if (!originResult.ok) {
    console.error('[member-self] VAULT_API_ORIGIN not configured or invalid:', originResult.reason);
    return json(res, 503, {
      ok: false,
      code: 'bridge_unconfigured',
      message: 'Member verification is not available right now. Please try again later.',
    });
  }

  if (req.method === 'GET') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const upstream = await fetchSelfUserRow(
        auth.token,
        originResult.origin,
        controller.signal
      );

      if (!upstream.ok) {
        return mapUpstreamError(res, upstream.status);
      }

      let body;
      try {
        body = await upstream.json();
      } catch {
        console.error('[member-self] upstream returned non-JSON');
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'We could not verify your member access right now. Please try again.',
        });
      }

      const parsed = parseVaultSelfUserResponse(body);
      if (parsed.kind === 'missing') {
        return json(res, 404, {
          ok: false,
          code: 'identity_missing',
          message: 'We could not find a connected PLCC member profile for this sign-in.',
        });
      }
      if (parsed.kind === 'invalid') {
        console.error('[member-self] sanitize failed:', parsed.reason);
        return json(res, 502, {
          ok: false,
          code: 'invalid_upstream',
          message: 'We could not verify your member access right now. Please try again.',
        });
      }

      return json(res, 200, {
        ok: true,
        member: parsed.member,
      });
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      console.error('[member-self] upstream error:', aborted ? 'timeout' : 'network');
      return json(res, 502, {
        ok: false,
        code: 'vault_unavailable',
        message: 'We could not verify your member access right now. Please try again.',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // PATCH
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
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_MEMBER_SELF_PATCH_BODY_BYTES) {
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
  } else if (rawBody == null) {
    return json(res, 400, {
      ok: false,
      code: 'invalid_body',
      message: 'That request was not valid. Please try again.',
    });
  } else if (typeof rawBody === 'object') {
    try {
      const encoded = JSON.stringify(rawBody);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_MEMBER_SELF_PATCH_BODY_BYTES) {
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
  } else {
    return json(res, 400, {
      ok: false,
      code: 'invalid_body',
      message: 'That request was not valid. Please try again.',
    });
  }

  const command = parseMemberSelfPatchCommand(rawBody);
  if (!command.ok) {
    return json(res, 400, {
      ok: false,
      code:
        command.reason === 'unknown_action'
          ? 'unknown_action'
          : command.reason === 'extra_fields'
            ? 'extra_fields'
            : 'invalid_body',
      message: 'That request was not valid. Please try again.',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const getUpstream = await fetchSelfUserRow(
      auth.token,
      originResult.origin,
      controller.signal
    );
    if (!getUpstream.ok) {
      return mapUpstreamError(res, getUpstream.status);
    }

    let getBody;
    try {
      getBody = await getUpstream.json();
    } catch {
      console.error('[member-self] GET self non-JSON before PATCH');
      return json(res, 502, {
        ok: false,
        code: 'invalid_upstream',
        message: 'We could not update your member profile right now. Please try again.',
      });
    }

    const selfParsed = parseVaultSelfUserResponse(getBody);
    if (selfParsed.kind === 'missing') {
      return json(res, 404, {
        ok: false,
        code: 'identity_missing',
        message: 'We could not find a connected PLCC member profile for this sign-in.',
      });
    }
    if (selfParsed.kind === 'invalid') {
      console.error('[member-self] GET self sanitize failed:', selfParsed.reason);
      return json(res, 502, {
        ok: false,
        code: 'invalid_upstream',
        message: 'We could not update your member profile right now. Please try again.',
      });
    }

    const users = Array.isArray(getBody?.users) ? getBody.users : [];
    const rawRow = users[0] && typeof users[0] === 'object' ? users[0] : null;
    if (!rawRow || String(rawRow.id) !== selfParsed.member.id) {
      return json(res, 502, {
        ok: false,
        code: 'invalid_upstream',
        message: 'We could not update your member profile right now. Please try again.',
      });
    }

    const existingPrefs = asPrefsObject(rawRow.notification_prefs);
    const notification_prefs = buildMergedPrefsForAction(existingPrefs, command.action);

    const patchUpstream = await fetch(buildVaultUsersPatchUrl(originResult.origin), {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        id: selfParsed.member.id,
        notification_prefs,
      }),
      signal: controller.signal,
      redirect: 'error',
    });

    if (!patchUpstream.ok) {
      return mapUpstreamError(res, patchUpstream.status);
    }

    let patchBody;
    try {
      patchBody = await patchUpstream.json();
    } catch {
      console.error('[member-self] PATCH upstream non-JSON');
      return json(res, 502, {
        ok: false,
        code: 'invalid_upstream',
        message: 'We could not update your member profile right now. Please try again.',
      });
    }

    const patched = parseVaultUserPatchResponse(patchBody);
    if (patched.kind === 'invalid') {
      console.error('[member-self] PATCH sanitize failed:', patched.reason);
      return json(res, 502, {
        ok: false,
        code: 'invalid_upstream',
        message: 'We could not update your member profile right now. Please try again.',
      });
    }

    return json(res, 200, {
      ok: true,
      member: patched.member,
    });
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    console.error('[member-self] PATCH upstream error:', aborted ? 'timeout' : 'network');
    return json(res, 502, {
      ok: false,
      code: 'vault_unavailable',
      message: 'We could not update your member profile right now. Please try again.',
    });
  } finally {
    clearTimeout(timer);
  }
}
