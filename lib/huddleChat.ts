/**
 * Ephemeral Live Huddle chat — LiveKit data messages only (no DB).
 * Wire format matches Vault `awc.huddle.chat` / type `huddle_chat` for interop.
 */

export const HUDDLE_CHAT_TYPE = 'huddle_chat' as const;
export const HUDDLE_CHAT_SCHEMA_VERSION = 1 as const;
export const HUDDLE_CHAT_MAX_LENGTH = 500;
export const HUDDLE_CHAT_TOPIC = 'awc.huddle.chat';

export type HuddleChatWirePayload = {
  type: typeof HUDDLE_CHAT_TYPE;
  v: typeof HUDDLE_CHAT_SCHEMA_VERSION;
  id: string;
  text: string;
  sentAt: number;
};

export type HuddleChatMessage = {
  id: string;
  text: string;
  sentAt: number;
  senderIdentity: string;
  senderName: string;
  isLocal: boolean;
  showModeratorBadge: boolean;
};

export function createHuddleChatId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeHuddleChatText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export function validateHuddleChatText(raw: unknown): {
  ok: boolean;
  text: string;
  reason?: 'empty' | 'too_long';
} {
  const text = normalizeHuddleChatText(raw);
  if (!text) return { ok: false, text: '', reason: 'empty' };
  if (text.length > HUDDLE_CHAT_MAX_LENGTH) {
    return { ok: false, text, reason: 'too_long' };
  }
  return { ok: true, text };
}

export function buildHuddleChatWirePayload(input: {
  id: string;
  text: string;
  sentAt?: number;
}): HuddleChatWirePayload | null {
  const checked = validateHuddleChatText(input.text);
  if (!checked.ok) return null;
  const id = String(input.id || '').trim();
  if (!id) return null;
  return {
    type: HUDDLE_CHAT_TYPE,
    v: HUDDLE_CHAT_SCHEMA_VERSION,
    id,
    text: checked.text,
    sentAt: Number(input.sentAt) || Date.now(),
  };
}

export function encodeHuddleChatPayload(payload: HuddleChatWirePayload): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(payload)));
}

export function parseHuddleChatWirePayload(raw: unknown): HuddleChatWirePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== HUDDLE_CHAT_TYPE) return null;
  if (Number(o.v) !== HUDDLE_CHAT_SCHEMA_VERSION) return null;
  const id = String(o.id || '').trim();
  if (!id || id.length > 80) return null;
  const checked = validateHuddleChatText(o.text);
  if (!checked.ok) return null;
  const sentAt = Number(o.sentAt);
  if (!Number.isFinite(sentAt) || sentAt <= 0) return null;
  return {
    type: HUDDLE_CHAT_TYPE,
    v: HUDDLE_CHAT_SCHEMA_VERSION,
    id,
    text: checked.text,
    sentAt,
  };
}

export function hydrateHuddleChatMessage(opts: {
  payload: HuddleChatWirePayload;
  senderIdentity: string;
  senderName: string;
  localIdentity: string;
  localCanModerate: boolean;
}): HuddleChatMessage | null {
  const identity = String(opts.senderIdentity || '').trim();
  if (!identity) return null;
  const isLocal = identity === String(opts.localIdentity || '').trim();
  return {
    id: opts.payload.id,
    text: opts.payload.text,
    sentAt: opts.payload.sentAt,
    senderIdentity: identity,
    senderName: String(opts.senderName || '').trim() || (isLocal ? 'You' : 'Member'),
    isLocal,
    showModeratorBadge: isLocal && Boolean(opts.localCanModerate),
  };
}

/** Decode DataReceived bytes → chat message (null if not chat / invalid). */
export function decodeIncomingHuddleChat(opts: {
  bytes: Uint8Array | ArrayBuffer;
  senderIdentity: string;
  senderName: string;
  localIdentity: string;
  localCanModerate: boolean;
  topic?: string | null;
}): HuddleChatMessage | null {
  if (opts.topic && opts.topic !== HUDDLE_CHAT_TOPIC) return null;
  const identity = String(opts.senderIdentity || '').trim();
  if (!identity) return null;
  let parsed: unknown;
  try {
    const bytes =
      opts.bytes instanceof Uint8Array ? opts.bytes : new Uint8Array(opts.bytes);
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const payload = parseHuddleChatWirePayload(parsed);
  if (!payload) return null;
  return hydrateHuddleChatMessage({
    payload,
    senderIdentity: identity,
    senderName: opts.senderName,
    localIdentity: opts.localIdentity,
    localCanModerate: opts.localCanModerate,
  });
}

export function appendHuddleChatMessage(
  prev: HuddleChatMessage[],
  next: HuddleChatMessage,
  max = 200
): HuddleChatMessage[] {
  if (prev.some((m) => m.id === next.id)) return prev;
  const merged = [...prev, next];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}
