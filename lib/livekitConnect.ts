/**
 * LiveKit connect with "out of minutes" detection — mirrored from PLCC Canaan
 * lib/huddle/livekit.ts. A 429 from LiveKit Cloud means the project quota is
 * used up; we stop retrying regions and switch the huddle to the backup line.
 */
import { Room, type RoomConnectOptions } from 'livekit-client';
export class LiveKitQuotaError extends Error {
  readonly code = 'livekit_quota';
  constructor() {
    super('LiveKit is not accepting new huddle connections right now.');
    this.name = 'LiveKitQuotaError';
  }
}

const QUOTA_LOOKBACK_MS = 20_000;

function recentLiveKitQuotaResponse(since = 0): boolean {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return false;
  const now = performance.now();
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  return entries.some((entry) => {
    if (entry.startTime < since) return false;
    const age = now - entry.startTime;
    if (age < 0 || age > QUOTA_LOOKBACK_MS) return false;
    if (!/livekit\.cloud/i.test(entry.name)) return false;
    return Number((entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus) === 429;
  });
}

export function isLiveKitQuotaError(err: unknown): boolean {
  if (err instanceof LiveKitQuotaError) return true;
  const msg = String((err as { message?: string })?.message || err || '');
  return /\b429\b|too many requests|quota/i.test(msg) || recentLiveKitQuotaResponse();
}

/**
 * One LiveKit connect. A 429 aborts the Room so the client does not walk every region.
 */
export async function connectLiveKitOnce(room: Room, url: string, token: string): Promise<void> {
  const NativeWebSocket = typeof window !== 'undefined' ? window.WebSocket : null;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  let sawQuota = false;
  if (NativeWebSocket && typeof window !== 'undefined') {
    const Wrapped = function HuddleWebSocket(
      this: WebSocket,
      wsUrl: string | URL,
      protocols?: string | string[]
    ) {
      const socket =
        protocols === undefined ? new NativeWebSocket(wsUrl) : new NativeWebSocket(wsUrl, protocols);
      const href = String(wsUrl);
      if (/livekit\.cloud/i.test(href)) {
        socket.addEventListener('error', () => {
          window.setTimeout(() => {
            if (!recentLiveKitQuotaResponse(startedAt)) return;
            sawQuota = true;
            void room.disconnect(true).catch(() => {});
          }, 30);
        });
      }
      return socket;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = NativeWebSocket.prototype;
    Object.assign(Wrapped, {
      CONNECTING: NativeWebSocket.CONNECTING,
      OPEN: NativeWebSocket.OPEN,
      CLOSING: NativeWebSocket.CLOSING,
      CLOSED: NativeWebSocket.CLOSED,
    });
    window.WebSocket = Wrapped;
  }
  try {
    const options: RoomConnectOptions = { autoSubscribe: true, maxRetries: 0 };
    await room.connect(url, token, options);
    if (sawQuota || recentLiveKitQuotaResponse(startedAt)) {
      await room.disconnect(true).catch(() => {});
      throw new LiveKitQuotaError();
    }
  } catch (err) {
    await room.disconnect(true).catch(() => {});
    if (sawQuota || isLiveKitQuotaError(err)) throw new LiveKitQuotaError();
    throw err;
  } finally {
    if (NativeWebSocket && typeof window !== 'undefined') window.WebSocket = NativeWebSocket;
  }
}
