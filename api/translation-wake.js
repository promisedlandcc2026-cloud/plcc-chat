import { parseBearerAuthorization, parseVaultSelfUserResponse } from './_utils/memberIdentity.js';
import { buildVaultSelfUserUrl, parseVaultApiOrigin } from './_utils/vaultOrigin.js';
import { poolInstanceCount, readWakeConfig, stsBody, wakeRequest } from './_utils/translationWake.js';

/**
 * POST /api/translation-wake: start the PLCC Live Translation worker (1 instance) if it is asleep.
 *
 * Who may call: any signed-in, approved PLCC member (verified with Vault, like /api/member-self).
 * Starting the worker does not switch translation on anywhere: the worker translates only for a
 * huddle's host/co-host (checked live against Canaan's room metadata) and scales itself back to 0
 * after ~10 idle minutes, so a stray call costs at most a few cents.
 *
 * Google credentials: none stored. Vercel OIDC → Workload Identity Federation → short-lived token
 * for a service account that can only change this worker pool. Never logs tokens.
 */
const TIMEOUT_MS = 8000;
const recent = new Map(); // per-user cooldown (best effort, per function instance)

function json(res, status, body) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).json(body);
}

async function call(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, code: 'method_not_allowed' });
  }
  const auth = parseBearerAuthorization(req.headers?.authorization);
  if (!auth.ok) return json(res, 401, { ok: false, code: 'unauthorized' });

  const conf = readWakeConfig(process.env);
  if (!conf.ok) {
    console.error('[translation-wake] not configured:', conf.missing.join(', '));
    return json(res, 503, { ok: false, code: 'translation_unconfigured' });
  }
  const origin = parseVaultApiOrigin(process.env.VAULT_API_ORIGIN, { allowHttpLocal: process.env.NODE_ENV !== 'production' });
  if (!origin.ok) return json(res, 503, { ok: false, code: 'bridge_unconfigured' });

  try {
    // 1. Signed-in, approved member?
    const self = await call(buildVaultSelfUserUrl(origin.origin), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${auth.token}` },
    });
    if (self.status === 401) return json(res, 401, { ok: false, code: 'unauthorized' });
    if (!self.ok) return json(res, 502, { ok: false, code: 'vault_unavailable' });
    const who = parseVaultSelfUserResponse(await self.json().catch(() => null));
    if (who.kind !== 'member') return json(res, 403, { ok: false, code: 'forbidden' });
    const memberId = String(who.member?.id || 'member');
    const last = recent.get(memberId) || 0;
    if (Date.now() - last < 20_000) return json(res, 202, { ok: true, waking: true, cooldown: true });
    recent.set(memberId, Date.now());
    if (recent.size > 500) recent.delete(recent.keys().next().value);

    // 2. Google token without a stored key.
    const oidc = String(req.headers?.['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || '');
    if (!oidc) {
      console.error('[translation-wake] Vercel OIDC token missing (enable OIDC federation for this project)');
      return json(res, 503, { ok: false, code: 'translation_unconfigured' });
    }
    const sts = await call('https://sts.googleapis.com/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: stsBody(conf.cfg.audience, oidc),
    });
    if (!sts.ok) throw new Error(`sts ${sts.status}`);
    const federated = (await sts.json()).access_token;
    const gen = await call(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(conf.cfg.serviceAccount)}:generateAccessToken`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${federated}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '300s' }),
      }
    );
    if (!gen.ok) throw new Error(`impersonate ${gen.status}`);
    const token = (await gen.json()).accessToken;

    // 3. Already awake? Otherwise ask for 1 instance.
    const cur = await call(`https://run.googleapis.com/v2/${conf.cfg.pool}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!cur.ok) throw new Error(`pool get ${cur.status}`);
    if (poolInstanceCount(await cur.json()) >= 1) return json(res, 200, { ok: true, awake: true });
    const w = wakeRequest(conf.cfg.pool);
    const up = await call(w.url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(w.body),
    });
    if (!up.ok) throw new Error(`pool patch ${up.status}`);
    console.info('[translation-wake] worker pool scaled to 1');
    return json(res, 202, { ok: true, waking: true });
  } catch (err) {
    console.error('[translation-wake] failed:', String(err?.message || err));
    return json(res, 502, { ok: false, code: 'wake_failed' });
  }
}
