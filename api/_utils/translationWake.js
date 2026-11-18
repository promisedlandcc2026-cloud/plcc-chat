/**
 * Pure helpers for /api/translation-wake (tested in scripts/ka-link-translation.test.mjs).
 *
 * Google access without any stored key: Vercel's OIDC token is exchanged through Google Workload
 * Identity Federation for a short-lived token of a service account that may ONLY change this one
 * Cloud Run worker pool (roles/run.developer on the pool resource).
 */
export const WORKER_POOL_RE = /^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/workerPools\/[a-z0-9-]+$/;
export const SA_RE = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, cfg: { audience: string, serviceAccount: string, pool: string } } | { ok: false, missing: string[] }}
 */
export function readWakeConfig(env) {
  const projectNumber = String(env.TRANSLATION_GCP_PROJECT_NUMBER || '').trim();
  const wifPool = String(env.TRANSLATION_WIF_POOL || '').trim();
  const wifProvider = String(env.TRANSLATION_WIF_PROVIDER || '').trim();
  const serviceAccount = String(env.TRANSLATION_WAKER_SA || '').trim();
  const pool = String(env.TRANSLATION_WORKER_POOL || '').trim();
  const missing = [];
  if (!/^\d{6,20}$/.test(projectNumber)) missing.push('TRANSLATION_GCP_PROJECT_NUMBER');
  if (!/^[a-z0-9-]{4,32}$/.test(wifPool)) missing.push('TRANSLATION_WIF_POOL');
  if (!/^[a-z0-9-]{4,32}$/.test(wifProvider)) missing.push('TRANSLATION_WIF_PROVIDER');
  if (!SA_RE.test(serviceAccount)) missing.push('TRANSLATION_WAKER_SA');
  if (!WORKER_POOL_RE.test(pool)) missing.push('TRANSLATION_WORKER_POOL');
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    cfg: {
      audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${wifPool}/providers/${wifProvider}`,
      serviceAccount,
      pool,
    },
  };
}

/** Body for Google STS token exchange (form-encoded). */
export function stsBody(audience, subjectToken) {
  return new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    audience,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    subject_token: subjectToken,
  }).toString();
}

/** Current instance count from a Cloud Run v2 worker pool resource (missing = 0). */
export function poolInstanceCount(body) {
  const n = Number(body?.scaling?.manualInstanceCount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function wakeRequest(pool) {
  return {
    url: `https://run.googleapis.com/v2/${pool}?update_mask=scaling.manualInstanceCount`,
    body: { scaling: { manualInstanceCount: 1 } },
  };
}
