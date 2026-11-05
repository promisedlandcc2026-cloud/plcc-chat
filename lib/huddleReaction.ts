/**
 * Live Huddle ephemeral emoji reactions.
 * Transport: LiveKit publishData / DataReceived on the huddle room.
 * Wire format matches PLCC Vault (awc.huddle.reaction) for interop.
 * Ephemeral / room-scoped only — not chat, not Raise Hand, no DB.
 */

export const HUDDLE_REACTION_TYPE = 'huddle_reaction' as const;
export const HUDDLE_REACTION_SCHEMA_VERSION = 1 as const;
/** Optional LiveKit data topic for reactions (publish + filter). */
export const HUDDLE_REACTION_TOPIC = 'awc.huddle.reaction';

export const HUDDLE_REACTION_KEYS = ['pray', 'heart', 'clap', 'praise', 'like'] as const;
export type HuddleReactionKey = (typeof HUDDLE_REACTION_KEYS)[number];

export const HUDDLE_REACTION_TTL_MS = 3200;
export const HUDDLE_REACTION_MAX_VISIBLE = 12;
/** Client-only UX cooldown — not a security boundary. */
export const HUDDLE_REACTION_COOLDOWN_MS = 600;

export type HuddleReactionOption = {
  key: HuddleReactionKey;
  emoji: string;
  label: string;
};

export const HUDDLE_REACTION_OPTIONS: readonly HuddleReactionOption[] = [
  { key: 'pray', emoji: '🙏', label: 'Pray' },
  { key: 'heart', emoji: '❤️', label: 'Love' },
  { key: 'clap', emoji: '👏', label: 'Clap' },
  { key: 'praise', emoji: '🙌', label: 'Praise' },
  { key: 'like', emoji: '👍', label: 'Like' },
] as const;

const REACTION_SET = new Set<string>(HUDDLE_REACTION_KEYS);

export function isHuddleReactionKey(value: unknown): value is HuddleReactionKey {
  return typeof value === 'string' && REACTION_SET.has(value);
}

export function huddleReactionEmoji(key: HuddleReactionKey): string {
  return HUDDLE_REACTION_OPTIONS.find((o) => o.key === key)?.emoji || '🙏';
}

export function huddleReactionLabel(key: HuddleReactionKey): string {
  return HUDDLE_REACTION_OPTIONS.find((o) => o.key === key)?.label || 'React';
}

/** Wire payload only — never trust sender fields from clients. */
export type HuddleReactionWirePayload = {
  type: typeof HUDDLE_REACTION_TYPE;
  v: typeof HUDDLE_REACTION_SCHEMA_VERSION;
  reaction: HuddleReactionKey;
  id: string;
  sentAt: number;
};

export type HuddleReactionEvent = {
  id: string;
  reaction: HuddleReactionKey;
  emoji: string;
  label: string;
  sentAt: number;
  expiresAt: number;
  senderIdentity: string;
  senderName: string;
  isLocal: boolean;
};

export function createHuddleReactionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rxn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildHuddleReactionWirePayload(input: {
  reaction: unknown;
  id: string;
  sentAt?: number;
}): HuddleReactionWirePayload | null {
  if (!isHuddleReactionKey(input.reaction)) return null;
  const id = String(input.id || '').trim();
  if (!id || id.length > 80) return null;
  const sentAt = Number(input.sentAt ?? Date.now());
  if (!Number.isFinite(sentAt) || sentAt <= 0) return null;
  return {
    type: HUDDLE_REACTION_TYPE,
    v: HUDDLE_REACTION_SCHEMA_VERSION,
    reaction: input.reaction,
    id,
    sentAt,
  };
}

export function encodeHuddleReactionPayload(payload: HuddleReactionWirePayload): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(payload)));
}

export function parseHuddleReactionWirePayload(raw: unknown): HuddleReactionWirePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== HUDDLE_REACTION_TYPE) return null;
  if (Number(o.v) !== HUDDLE_REACTION_SCHEMA_VERSION) return null;
  if (!isHuddleReactionKey(o.reaction)) return null;
  const id = String(o.id || '').trim();
  if (!id || id.length > 80) return null;
  const sentAt = Number(o.sentAt);
  if (!Number.isFinite(sentAt) || sentAt <= 0) return null;
  return {
    type: HUDDLE_REACTION_TYPE,
    v: HUDDLE_REACTION_SCHEMA_VERSION,
    reaction: o.reaction,
    id,
    sentAt,
  };
}

export function hydrateHuddleReactionEvent(opts: {
  payload: HuddleReactionWirePayload;
  senderIdentity: string;
  senderName: string;
  localIdentity: string;
  ttlMs?: number;
  nowMs?: number;
}): HuddleReactionEvent | null {
  const identity = String(opts.senderIdentity || '').trim();
  if (!identity) return null;
  const now = Number(opts.nowMs ?? Date.now());
  const ttl = Math.max(500, Number(opts.ttlMs ?? HUDDLE_REACTION_TTL_MS) || HUDDLE_REACTION_TTL_MS);
  const isLocal = identity === String(opts.localIdentity || '').trim();
  return {
    id: opts.payload.id,
    reaction: opts.payload.reaction,
    emoji: huddleReactionEmoji(opts.payload.reaction),
    label: huddleReactionLabel(opts.payload.reaction),
    sentAt: opts.payload.sentAt,
    expiresAt: now + ttl,
    senderIdentity: identity,
    senderName: String(opts.senderName || '').trim() || (isLocal ? 'You' : 'Member'),
    isLocal,
  };
}

/**
 * Append a transient reaction. Duplicate ids are ignored.
 * Newest reactions are kept when over the bound.
 */
export function appendHuddleReactionEvent(
  prev: HuddleReactionEvent[],
  next: HuddleReactionEvent,
  maxVisible = HUDDLE_REACTION_MAX_VISIBLE
): HuddleReactionEvent[] {
  if (prev.some((r) => r.id === next.id)) return prev;
  const merged = [...prev, next];
  const limit = Math.max(1, Number(maxVisible) || HUDDLE_REACTION_MAX_VISIBLE);
  if (merged.length <= limit) return merged;
  return merged.slice(merged.length - limit);
}

export function expireHuddleReactions(
  prev: HuddleReactionEvent[],
  nowMs: number = Date.now()
): HuddleReactionEvent[] {
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return prev;
  const next = prev.filter((r) => r.expiresAt > now);
  return next.length === prev.length ? prev : next;
}

export function clearHuddleReactions(): HuddleReactionEvent[] {
  return [];
}

/** Client-only cooldown gate — UX protection, not security. */
export function shouldAllowHuddleReactionSend(opts: {
  lastSentAt: number | null | undefined;
  nowMs?: number;
  cooldownMs?: number;
}): boolean {
  const last = Number(opts.lastSentAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  const now = Number(opts.nowMs ?? Date.now());
  const cool = Math.max(0, Number(opts.cooldownMs ?? HUDDLE_REACTION_COOLDOWN_MS) || 0);
  return now - last >= cool;
}
