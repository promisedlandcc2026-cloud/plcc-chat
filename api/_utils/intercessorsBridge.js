import { parseBearerAuthorization } from './memberIdentity.js';
import {
  parsePrayerMarkCommand,
  parseIntercessorsQuery,
  parseVaultIntercessorsAccess,
  parseVaultIntercessorsList,
} from './intercessorsSanitize.js';
import { buildVaultIntercessorsUrl, parseVaultApiOrigin } from './vaultOrigin.js';

const UPSTREAM_TIMEOUT_MS = 20000;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.status(status).json(body);
}

/**
 * Narrow same-origin bridge (served by api/vault-news.js to stay on the Hobby function budget):
 * GET /api/intercessors?action=access      → can this member open the prayer list?
 * GET /api/intercessors?from=…&to=…        → shared prayer requests in that window
 * GET /api/intercessors?view=answered       → Praise reports (answered prayers)
 * POST /api/intercessors {action,id,value}  → mark Prayed / Answered
 * → Vault GET …/community&subResource=intercessors. Signed-in only. Never logs tokens or prayers.
 */
export async function handleIntercessorsBridge(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'This endpoint only supports GET and POST.' });
  }
  const auth = parseBearerAuthorization(req.headers?.authorization);
  if (!auth.ok) return json(res, 401, { ok: false, code: 'unauthorized', message: 'Please sign in again to continue.' });

  let mark = null;
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    mark = parsePrayerMarkCommand(body);
    if (!mark) return json(res, 400, { ok: false, code: 'invalid_body', message: 'That change could not be saved.' });
  }
  const q = req.method === 'POST' ? { ok: true } : parseIntercessorsQuery(req.query || {});
  if (!q.ok) return json(res, 400, { ok: false, code: 'invalid_query', message: 'Those dates are not valid.' });

  const originResult = parseVaultApiOrigin(process.env.VAULT_API_ORIGIN, {
    allowHttpLocal: process.env.NODE_ENV !== 'production',
  });
  if (!originResult.ok) {
    console.error('[intercessors] VAULT_API_ORIGIN invalid:', originResult.reason);
    return json(res, 503, { ok: false, code: 'bridge_unconfigured', message: 'The prayer list is not available right now.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const headers = { Accept: 'application/json', Authorization: `Bearer ${auth.token}` };
    if (mark) headers['Content-Type'] = 'application/json';
    const upstream = await fetch(buildVaultIntercessorsUrl(originResult.origin, mark ? {} : q), {
      method: mark ? 'POST' : 'GET',
      headers,
      body: mark ? JSON.stringify(mark) : undefined,
      signal: controller.signal,
    });
    const data = await upstream.json().catch(() => null);
    if (upstream.status === 401) return json(res, 401, { ok: false, code: 'unauthorized', message: 'Please sign in again to continue.' });
    if (upstream.status === 403) {
      const msg = data && typeof data.error === 'string' ? data.error.slice(0, 200) : 'The Prayer Watch is for the Intercessors and the prayer team.';
      return json(res, 403, { ok: false, code: 'forbidden', message: msg });
    }
    if (upstream.status === 409 || upstream.status === 404) {
      const msg = data && typeof data.error === 'string' ? data.error.slice(0, 200) : 'That change could not be saved.';
      return json(res, upstream.status, { ok: false, code: upstream.status === 409 ? 'needs_setup' : 'not_found', message: msg });
    }
    if (!upstream.ok) {
      console.error('[intercessors] upstream status', upstream.status);
      return json(res, 502, { ok: false, code: 'vault_unavailable', message: 'We couldn’t load the prayer list. Please try again.' });
    }
    if (mark) return json(res, 200, { ok: true });
    if (q.action === 'access') return json(res, 200, parseVaultIntercessorsAccess(data));
    const list = parseVaultIntercessorsList(data);
    if (!list) return json(res, 502, { ok: false, code: 'vault_unavailable', message: 'We couldn’t load the prayer list. Please try again.' });
    return json(res, 200, list);
  } catch (err) {
    const aborted = err && typeof err === 'object' && err.name === 'AbortError';
    console.error('[intercessors] upstream error', aborted ? 'timeout' : 'network');
    return json(res, 504, { ok: false, code: 'vault_unavailable', message: 'We couldn’t load the prayer list. Please try again.' });
  } finally {
    clearTimeout(timer);
  }
}
