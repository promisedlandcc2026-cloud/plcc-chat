/**
 * Phase 5 — Data Saver (Nov 2026).
 *
 * Most PLCC members join on mobile data (paid bundles in Uganda), not WiFi.
 * Data Saver is ON by default:
 *  - other people's camera video is not downloaded (tap "Show video" to see it);
 *  - audio, waiting music and screen share (sermon slides, scripture) still come through;
 *  - photos sent in Messages are made smaller, and videos don't preload.
 *
 * The choice is saved per phone (localStorage), shared by Ka Link calls and Messages.
 * Also here: weak-signal labels (#30) and "On a phone call" status (#34).
 */

export const DATA_SAVER_KEY = 'plcc_ka_link_data_saver';
const DATA_SAVER_EVENT = 'plcc-data-saver-change';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** On unless the member turned it off on this phone. */
export function readDataSaver(store: StorageLike | null = storage()): boolean {
  try {
    return store?.getItem(DATA_SAVER_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeDataSaver(on: boolean, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(DATA_SAVER_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  try {
    window.dispatchEvent(new CustomEvent(DATA_SAVER_EVENT, { detail: on }));
  } catch {
    /* not in a browser */
  }
}

export function subscribeDataSaver(fn: (on: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onLocal = (e: Event) => fn(Boolean((e as CustomEvent).detail));
  const onStorage = (e: StorageEvent) => {
    if (e.key === DATA_SAVER_KEY) fn(e.newValue !== '0');
  };
  window.addEventListener(DATA_SAVER_EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(DATA_SAVER_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Should this phone download a remote track?
 * source/kind use LiveKit's string values ('camera', 'microphone', 'screen_share', 'unknown'; 'audio' | 'video').
 */
export function shouldSubscribeTrack(source: string, kind: string, dataSaver: boolean): boolean {
  if (kind === 'audio') return true; // voices, waiting music, screen-share sound
  if (source === 'screen_share') return true; // slides/scripture: low frame rate, worth it
  return !dataSaver; // camera video
}

/** Photo size for Messages: smaller with Data Saver on. */
export function photoSettings(dataSaver: boolean): { maxEdge: number; quality: number } {
  return dataSaver ? { maxEdge: 1280, quality: 0.72 } : { maxEdge: 1600, quality: 0.82 };
}

/** Videos in Messages: don't download anything until the member taps play. */
export function videoPreload(dataSaver: boolean): 'none' | 'metadata' {
  return dataSaver ? 'none' : 'metadata';
}

// ---------------------------------------------------------------------------
// #30 connection quality
// ---------------------------------------------------------------------------

export type SignalLevel = 'ok' | 'weak' | 'lost';

/** LiveKit ConnectionQuality values: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'. */
export function signalLevel(quality: string | undefined | null): SignalLevel {
  if (quality === 'poor') return 'weak';
  if (quality === 'lost') return 'lost';
  return 'ok';
}

export function signalLabel(level: SignalLevel): string {
  if (level === 'weak') return 'Weak signal';
  if (level === 'lost') return 'Signal lost';
  return '';
}

// ---------------------------------------------------------------------------
// #34 away status (phone call / stepped away), sent as a small data message
// ---------------------------------------------------------------------------

export const KA_LINK_AWAY_TOPIC = 'plcc-away';
export type AwayReason = 'call' | 'away';
export type AwayWire = { v: 1; t: 'away'; r: AwayReason } | { v: 1; t: 'back' };

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

export function encodeAwayWire(wire: AwayWire): Uint8Array {
  const text = JSON.stringify(wire);
  return enc ? enc.encode(text) : new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
}

export function decodeAwayWire(payload: Uint8Array | null | undefined): AwayWire | null {
  if (!payload || payload.byteLength > 256 || !dec) return null;
  try {
    const raw = JSON.parse(dec.decode(payload)) as Record<string, unknown>;
    if (raw?.v !== 1) return null;
    if (raw.t === 'back') return { v: 1, t: 'back' };
    if (raw.t === 'away' && (raw.r === 'call' || raw.r === 'away')) return { v: 1, t: 'away', r: raw.r };
    return null;
  } catch {
    return null;
  }
}

export function awayLabel(reason: AwayReason | null | undefined): string {
  if (reason === 'call') return 'On a phone call';
  if (reason === 'away') return 'Listening in background';
  return '';
}

/** Shown when a member comes back after their mic was interrupted. */
export const KA_LINK_BACK_MUTED_NOTICE = "Welcome back. You're muted — tap Unmute when you're ready to speak.";
export const KA_LINK_WEAK_SIGNAL_NOTICE =
  'Your signal is weak. Data Saver keeps the prayer clear by pausing video — you can turn it on in More.';
