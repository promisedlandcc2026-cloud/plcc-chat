/**
 * Phone alerts bridge:
 *   GET  /api/push?action=status&endpoint=…
 *   POST /api/push?action=subscribe   { subscription, topics }
 *   POST /api/push?action=unsubscribe { endpoint }
 *   POST /api/push?action=test
 * → PLCC Canaan /api/vault?resource=push (stores phones, sends the alerts).
 * Rides on api/vault-news.js (bridge=push) for the Hobby function limit.
 * Staff broadcasts are sent from the Vault itself, never through Connect.
 * Fixed upstream; forwards only the member's Bearer token; never logs it.
 */
import { parseBearerAuthorization } from './memberIdentity.js';
import { parseVaultApiOrigin } from './vaultOrigin.js';

const TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 4096;
const UNAVAILABLE = 'Alerts are not available right now. Please try again.';

/** Member actions only. */
export function pushUpstreamQuery(method, query) {
  const action = String(query?.action || '').toLowerCase();
  if (method === 'GET' && (action === 'status' || action === '')) {
    const endpoint = String(query?.endpoint || '').trim();
    const qs = new URLSearchParams({ resource: 'push', action: 'status' });
    if (endpoint && endpoint.length <= 1000 && endpoint.startsWith('https://')) qs.set('endpoint', endpoint);
    return { ok: true, qs: qs.toString() };
  }
  if (method === 'POST' && (action === 'subscribe' || action === 'unsubscribe' || action === 'test')) {
    return { ok: true, qs: `resource=push&action=${action}` };
  }
  return { ok: false, status: 404, code: 'unknown_action', message: 'Unknown alerts request.' };
}

export async function handlePushBridge(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const send = (status, body) => res.status(status).json(body);
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(405, { ok: false, code: 'method_not_allowed', error: 'Method not allowed.' });
  }
  const auth = parseBearerAuthorization(req.headers?.authorization);
  if (!auth.ok) return send(401, { ok: false, code: 'unauthorized', error: 'Please sign in again to continue.' });

  const route = pushUpstreamQuery(method, req.query);
  if (!route.ok) return send(route.status, { ok: false, code: route.code, error: route.message });

  const originResult = parseVaultApiOrigin(process.env.VAULT_API_ORIGIN, {
    allowHttpLocal: process.env.NODE_ENV !== 'production',
  });
  if (!originResult.ok) {
    console.error('[push] VAULT_API_ORIGIN invalid:', originResult.reason);
    return send(503, { ok: false, code: 'bridge_unconfigured', error: UNAVAILABLE });
  }

  let body;
  if (method === 'POST') {
    let raw = req.body;
    if (typeof raw !== 'string') raw = JSON.stringify(raw ?? {});
    if (raw.length > MAX_BODY_BYTES) return send(413, { ok: false, code: 'body_too_large', error: 'That request is too large.' });
    body = raw;
  }

  const url = `${String(originResult.origin).replace(/\/+$/, '')}/api/vault?${route.qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    const data = await upstream.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      console.error('[push] upstream status', upstream.status);
      return send(502, { ok: false, code: 'vault_unavailable', error: UNAVAILABLE });
    }
    // Members never need to know who can broadcast.
    const { canBroadcast: _hidden, ...safe } = data;
    return send(upstream.status, safe);
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    console.error('[push] error:', aborted ? 'timeout' : 'network');
    return send(502, { ok: false, code: 'vault_unavailable', error: UNAVAILABLE });
  } finally {
    clearTimeout(timer);
  }
}
