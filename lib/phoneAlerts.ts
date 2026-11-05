/**
 * Phone alerts (web push) for PLCC Chat — new chat messages only.
 * (Church announcements, prayer and Vault News alerts stay in PLCC Connect.)
 *
 * - The service worker (/sw.js) shows alerts and opens the chat when tapped.
 * - Turning alerts on asks the phone for permission, then saves this phone's
 *   push subscription in the Vault (via /api/push), which sends the alerts.
 * - iPhone/iPad: alerts only work from the Home Screen app (iOS 16.4+), so
 *   Safari tabs are sent to the install guide first.
 */
import { getValidAccessToken } from './authAccessToken';
import { detectInstallPlatform, isRunningInstalled } from './installPrompt';

export type AlertTopic = 'chat';
const CHAT_TOPICS: AlertTopic[] = ['chat'];

export type AlertsState =
  | { kind: 'unsupported' } // this browser can't do push at all
  | { kind: 'needs-install' } // iPhone in Safari: add to Home Screen first
  | { kind: 'not-set-up' } // the church hasn't finished setup (no keys)
  | { kind: 'signed-out' }
  | { kind: 'blocked' } // person tapped "Don't Allow" earlier
  | { kind: 'off' }
  | { kind: 'on'; topics: AlertTopic[] };

const NUDGE_KEY = 'awc_chat_alerts_nudge_dismissed_at';

function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Register the alerts worker once (safe to call on every load). */
export async function registerAlertsWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[alerts] worker registration failed', err instanceof Error ? err.message : err);
    return null;
  }
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const token = await getValidAccessToken();
  if (!token) throw Object.assign(new Error('Please sign in first.'), { code: 'signed_out' });
  const res = await fetch(`/api/push${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw Object.assign(new Error(data?.error || 'Alerts are not available right now. Please try again.'), { status: res.status });
  }
  return data;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await registerAlertsWorker());
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function getAlertsState(): Promise<AlertsState> {
  if (!supported()) {
    return detectInstallPlatform() === 'ios' && !isRunningInstalled() ? { kind: 'needs-install' } : { kind: 'unsupported' };
  }
  if (detectInstallPlatform() === 'ios' && !isRunningInstalled()) return { kind: 'needs-install' };
  if (!(await getValidAccessToken())) return { kind: 'signed-out' };
  if (Notification.permission === 'denied') return { kind: 'blocked' };

  const sub = await currentSubscription().catch(() => null);
  const status = await api(`?action=status${sub ? `&endpoint=${encodeURIComponent(sub.endpoint)}` : ''}`);
  if (!status.enabled) return { kind: 'not-set-up' };
  if (sub && status.subscribed) return { kind: 'on', topics: CHAT_TOPICS };
  if (sub && Notification.permission === 'granted') {
    // Phone still has a subscription the Vault doesn't know (new account on
    // this phone, or the browser renewed it): quietly save it again.
    try {
      const saved = await api('?action=subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: sub.toJSON(), topics: CHAT_TOPICS }),
      });
      return { kind: 'on', topics: saved.topics || CHAT_TOPICS };
    } catch {
      return { kind: 'off' };
    }
  }
  return { kind: 'off' };
}

const ALERTS_EVENT = 'awc:alerts-state';

function announce(state: AlertsState): AlertsState {
  try {
    window.dispatchEvent(new CustomEvent<AlertsState>(ALERTS_EVENT, { detail: state }));
  } catch {
    /* non-browser */
  }
  return state;
}

/** Alerts were turned on/off somewhere else on this page (chat list card ↔ Account menu). */
export function onAlertsStateChange(cb: (state: AlertsState) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<AlertsState>).detail);
  window.addEventListener(ALERTS_EVENT, handler);
  return () => window.removeEventListener(ALERTS_EVENT, handler);
}

/** Ask permission (must run from a tap) and save this phone. */
export async function turnOnAlerts(topics: AlertTopic[] = CHAT_TOPICS): Promise<AlertsState> {
  return announce(await subscribeThisPhone(topics));
}

async function subscribeThisPhone(topics: AlertTopic[]): Promise<AlertsState> {
  if (!supported()) return { kind: 'unsupported' };
  const status = await api('?action=status');
  if (!status.enabled || !status.publicKey) return { kind: 'not-set-up' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? { kind: 'blocked' } : { kind: 'off' };

  const reg = (await registerAlertsWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(status.publicKey) as BufferSource,
    });
  }
  const saved = await api('?action=subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub.toJSON(), topics }),
  });
  return { kind: 'on', topics: saved.topics || topics };
}

export async function updateAlertTopics(topics: AlertTopic[]): Promise<AlertsState> {
  const sub = await currentSubscription();
  if (!sub) return { kind: 'off' };
  const saved = await api('?action=subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub.toJSON(), topics }),
  });
  return { kind: 'on', topics: saved.topics || topics };
}

export async function turnOffAlerts(): Promise<AlertsState> {
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await api('?action=unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
    await sub.unsubscribe().catch(() => false);
  }
  return announce({ kind: 'off' });
}

export async function sendTestAlert(): Promise<number> {
  const d = await api('?action=test', { method: 'POST', body: '{}' });
  return Number(d.sent || 0);
}

/** Home-page nudge: shown until turned on, or for 30 days after "Not now". */
export function nudgeDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(NUDGE_KEY) || 0);
    return Boolean(at) && Date.now() - at < 30 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function dismissNudge(): void {
  try {
    localStorage.setItem(NUDGE_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}
