/**
 * Wake the translator (on demand). The worker pool sleeps at 0 instances when unused; the host's
 * switch asks Ka Link's server to start one instance. Members never call this.
 */
import { getValidAccessToken } from '../authAccessToken';

export async function wakeTranslator(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const token = await getValidAccessToken();
    if (!token) return { ok: false, message: 'Please sign in again to switch translation on.' };
    const res = await fetch('/api/translation-wake', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) return { ok: true };
    if (res.status === 503) return { ok: false, message: 'Live translation is not set up yet for this Ka Link.' };
    if (res.status === 401) return { ok: false, message: 'Please sign in again to switch translation on.' };
    return { ok: false, message: 'Could not start the translator. Try again in a moment.' };
  } catch {
    return { ok: false, message: 'Could not reach the translator. Check your connection.' };
  }
}
