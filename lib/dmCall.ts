/**
 * Private calls (WhatsApp-style) in a direct message: audio or video, open to every member.
 * All rules (both people in the DM, no blocks, not paused) are checked by PLCC Canaan.
 */
import { getValidAccessToken } from './authAccessToken';

export type DmCallPass = {
  token: string;
  url: string;
  channelId: string;
  partnerId: string | null;
  video: boolean;
  ringSeconds: number;
};

export type DmCallStatus = {
  active: boolean;
  ringing: boolean;
  video: boolean;
  callerId: string | null;
  callerName: string | null;
};

export class DmCallError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'DmCallError';
  }
}

async function post(body: Record<string, unknown>): Promise<any> {
  const token = await getValidAccessToken();
  if (!token) throw new DmCallError('Please sign in again.', 'unauthorized');
  let res: Response;
  try {
    res = await fetch('/api/community-chat?resource=dm-call', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new DmCallError('No internet connection. Check your data and try again.', 'offline');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok !== true) {
    throw new DmCallError(String(data?.message || 'The call did not go through. Please try again.'), String(data?.code || 'call_failed'));
  }
  return data;
}

/** My private topic for incoming calls (null when the server has none). */
export async function fetchCallInbox(): Promise<{ topic: string | null; ringSeconds: number }> {
  const d = await post({ action: 'inbox' });
  return { topic: d.topic || null, ringSeconds: Number(d.ringSeconds) || 45 };
}

export async function ringDmCall(channelId: string, video: boolean): Promise<DmCallPass> {
  const d = await post({ action: 'ring', channelId, video });
  return { token: d.token, url: d.url, channelId, partnerId: d.partnerId, video: d.video === true, ringSeconds: Number(d.ringSeconds) || 45 };
}

export async function joinDmCall(channelId: string): Promise<DmCallPass> {
  const d = await post({ action: 'join', channelId });
  return { token: d.token, url: d.url, channelId, partnerId: d.partnerId, video: d.video === true, ringSeconds: 45 };
}

export async function declineDmCall(channelId: string): Promise<void> {
  await post({ action: 'decline', channelId }).catch(() => {});
}

export async function endDmCall(channelId: string): Promise<void> {
  await post({ action: 'end', channelId }).catch(() => {});
}

export async function fetchDmCallStatus(channelId: string): Promise<DmCallStatus | null> {
  try {
    const d = await post({ action: 'status', channelId });
    return { active: d.active === true, ringing: d.ringing === true, video: d.video === true, callerId: d.callerId, callerName: d.callerName };
  } catch {
    return null;
  }
}

/** Pure: "0:07", "12:30", "1:02:03". */
export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Pure: what the call screen says under the name. */
export function callStatusLine(phase: CallPhase, opts: { video: boolean; seconds?: number; endedReason?: string | null }): string {
  switch (phase) {
    case 'outgoing':
      return 'Ringing…';
    case 'connecting':
      return 'Connecting…';
    case 'incoming':
      return opts.video ? 'Incoming video call' : 'Incoming voice call';
    case 'connected':
      return formatCallDuration(opts.seconds || 0);
    case 'reconnecting':
      return 'Reconnecting…';
    case 'ended':
      if (opts.endedReason === 'declined') return 'Call declined';
      if (opts.endedReason === 'no-answer') return 'No answer';
      if (opts.endedReason === 'failed') return 'Call failed';
      return 'Call ended';
    default:
      return '';
  }
}

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

/** Pure: ?call=answer on a chat link (from the phone alert). */
export function wantsAnswerFromUrl(search: string): boolean {
  try {
    return new URLSearchParams(search).get('call') === 'answer';
  } catch {
    return false;
  }
}
