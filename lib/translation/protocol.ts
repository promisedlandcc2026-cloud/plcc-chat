// Copied unchanged from promisedlandcc2026-cloud/plcc-live-translation src/protocol.ts — keep in sync.
/**
 * Wire protocol for translated captions (v1). Dependency-free so Ka Link and Sanctum can
 * copy or import this file unchanged.
 *
 * Captions travel on the LiveKit data channel of the prayer room itself, under TOPIC.
 * Only participants holding a server-minted token for that room receive them.
 */

export const TRANSLATION_TOPIC = 'plcc.translate.v1';
export const PROTOCOL_VERSION = 1 as const;
export const MAX_CAPTION_CHARS = 500;
/** LiveKit participant attribute a speaker sets to keep their voice out of transcription. */
export const OPT_OUT_ATTRIBUTE = 'plcc.translate.optout';
/** Ka Link's existing role attribute (minted by PLCC Canaan). */
export const ROLE_ATTRIBUTE = 'plcc.role';

export type RetentionMode = 'none' | 'session';

/**
 * SECURITY: every Ka Link participant can publish data packets, so anyone in the room could
 * send a fake caption or a fake "translation off" on this topic. The worker sends ONLY through
 * LiveKit's server API, and server-sent packets carry no sender participant. Clients must
 * drop translation packets that come from any participant:
 *
 *   room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
 *     if (!isTrustedTranslationPacket(topic, participant?.identity)) return;
 *     ...
 */
export function isTrustedTranslationPacket(topic: string | undefined, senderIdentity: string | undefined | null): boolean {
  return topic === TRANSLATION_TOPIC && !senderIdentity;
}

export interface CaptionSpeaker {
  /** LiveKit identity (the member's Canaan user id). */
  id: string;
  name: string;
}

export interface CaptionEvent {
  v: 1;
  t: 'caption';
  /** Translation session id — changes each time translation is switched on. */
  sid: string;
  /** Utterance id, unique within the session. A partial and its final share one uid. */
  uid: string;
  /** Revision within the utterance; higher replaces lower. Finals are never replaced. */
  rev: number;
  final: boolean;
  /** Language of `text`. */
  lang: string;
  /** Language the speaker spoke. */
  src: string;
  /** True when `text` is a machine translation of the speaker's words. */
  tr: boolean;
  text: string;
  spk: CaptionSpeaker;
  /** Epoch ms: utterance start, utterance end (finals), and send time. */
  ts: { start: number; end?: number; sent: number };
}

export interface StatusEvent {
  v: 1;
  t: 'status';
  sid: string;
  state: 'on' | 'off';
  /** Spoken language being transcribed. */
  src: string;
  /** Caption languages offered to listeners (includes src). */
  langs: string[];
  retention: RetentionMode;
  /** Plain-language notice every client must show while state is 'on'. */
  notice: string;
  startedBy: CaptionSpeaker | null;
  reason?: string;
  at: number;
}

export type TranslationEvent = CaptionEvent | StatusEvent;

export function disclosureNotice(retention: RetentionMode): string {
  return retention === 'none'
    ? 'Live translation is on. What is said here is sent to Google Cloud to create captions. Captions are not saved.'
    : 'Live translation is on. What is said here is sent to Google Cloud to create captions. Moderators can keep a transcript until this session ends.';
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeEvent(event: TranslationEvent): Uint8Array {
  return enc.encode(JSON.stringify(event));
}

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const langCode = (v: unknown): string => {
  const s = str(v, 16);
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(s) ? s : '';
};
const speaker = (v: unknown): CaptionSpeaker | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  return id ? { id, name: str(o.name, 80) || 'Member' } : null;
};

/** Validates an incoming message; anything unexpected returns null and is dropped. */
export function decodeEvent(bytes: Uint8Array): TranslationEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(dec.decode(bytes));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== PROTOCOL_VERSION) return null;
  const sid = str(o.sid, 64);
  if (!sid) return null;

  if (o.t === 'caption') {
    const uid = str(o.uid, 96);
    const lang = langCode(o.lang);
    const src = langCode(o.src);
    const spk = speaker(o.spk);
    const ts = (o.ts ?? {}) as Record<string, unknown>;
    if (!uid || !lang || !src || !spk) return null;
    const rev = Math.max(0, Math.floor(num(o.rev)));
    const end = num(ts.end);
    return {
      v: 1,
      t: 'caption',
      sid,
      uid,
      rev,
      final: o.final === true,
      lang,
      src,
      tr: o.tr === true,
      text: str(o.text, MAX_CAPTION_CHARS),
      spk,
      ts: { start: num(ts.start), ...(end ? { end } : {}), sent: num(ts.sent) },
    };
  }

  if (o.t === 'status') {
    const state = o.state === 'on' ? 'on' : o.state === 'off' ? 'off' : null;
    const src = langCode(o.src);
    if (!state || !src) return null;
    const langs = Array.isArray(o.langs) ? o.langs.map(langCode).filter(Boolean).slice(0, 12) : [];
    return {
      v: 1,
      t: 'status',
      sid,
      state,
      src,
      langs,
      retention: o.retention === 'session' ? 'session' : 'none',
      notice: str(o.notice, 400),
      startedBy: speaker(o.startedBy),
      ...(o.reason ? { reason: str(o.reason, 60) } : {}),
      at: num(o.at),
    };
  }
  return null;
}
