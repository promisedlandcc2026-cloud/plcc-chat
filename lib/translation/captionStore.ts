// Copied from promisedlandcc2026-cloud/plcc-live-translation src/client/captionStore.ts — keep in sync.
/**
 * Listener-side caption state for Ka Link / Sanctum. Pure and dependency-free (apart from
 * ../protocol), so it runs in the browser and is unit-tested here.
 *
 *   const store = new CaptionStore({ language: 'lg' });
 *   room.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
 *     if (topic !== TRANSLATION_TOPIC) return;
 *     const ev = decodeEvent(payload);
 *     if (ev && store.apply(ev)) render(store.visible(Date.now()));
 *   });
 *
 * Handles: out-of-order and duplicate packets (revisions; finals are locked), a new
 * session after translation is switched off and on again, and per-listener language
 * choice that never touches the audio.
 */
import type { CaptionEvent, StatusEvent, TranslationEvent } from './protocol';

export interface CaptionLine {
  uid: string;
  speakerId: string;
  speakerName: string;
  text: string;
  lang: string;
  final: boolean;
  /** True when the listener's language isn't ready yet and the original words are shown. */
  original: boolean;
  start: number;
  updatedAt: number;
}

export interface CaptionStoreOptions {
  language: string;
  /** Show the speaker's own words while a translation is on its way. Default true. */
  showOriginalWhilePending?: boolean;
  /** How long a finished line stays on screen. */
  lineTtlMs?: number;
  maxLines?: number;
  now?: () => number;
}

interface Utterance {
  uid: string;
  src: string;
  speaker: { id: string; name: string };
  start: number;
  /** Latest event per caption language. */
  byLang: Map<string, CaptionEvent>;
  touchedAt: number;
}

export class CaptionStore {
  private language: string;
  private readonly showOriginal: boolean;
  private readonly ttl: number;
  private readonly maxLines: number;
  private readonly now: () => number;
  private sessionId: string | null = null;
  private utterances = new Map<string, Utterance>();
  status: StatusEvent | null = null;

  constructor(opts: CaptionStoreOptions) {
    this.language = opts.language;
    this.showOriginal = opts.showOriginalWhilePending ?? true;
    this.ttl = opts.lineTtlMs ?? 8000;
    this.maxLines = opts.maxLines ?? 3;
    this.now = opts.now ?? (() => Date.now());
  }

  get selectedLanguage(): string {
    return this.language;
  }

  /** Changing language is local to this listener; nothing is sent anywhere. */
  setLanguage(lang: string): void {
    this.language = lang;
  }

  get isOn(): boolean {
    return this.status?.state === 'on';
  }

  /** Returns true when what's on screen may have changed. */
  apply(event: TranslationEvent): boolean {
    if (event.t === 'status') return this.applyStatus(event);
    return this.applyCaption(event);
  }

  private resetFor(sid: string): void {
    this.sessionId = sid;
    this.utterances.clear();
  }

  private applyStatus(ev: StatusEvent): boolean {
    if (this.status && ev.sid === this.status.sid && ev.at < this.status.at) return false; // stale heartbeat
    if (ev.sid !== this.sessionId) this.resetFor(ev.sid);
    const changed = !this.status || this.status.state !== ev.state || this.status.sid !== ev.sid;
    this.status = ev;
    if (ev.state === 'off') this.utterances.clear();
    return changed || ev.state === 'off';
  }

  private applyCaption(ev: CaptionEvent): boolean {
    if (this.status?.state === 'off' && this.status.sid === ev.sid) return false; // late packet after stop
    if (ev.sid !== this.sessionId) this.resetFor(ev.sid);
    let u = this.utterances.get(ev.uid);
    if (!u) {
      u = { uid: ev.uid, src: ev.src, speaker: ev.spk, start: ev.ts.start, byLang: new Map(), touchedAt: 0 };
      this.utterances.set(ev.uid, u);
    }
    const prev = u.byLang.get(ev.lang);
    if (prev) {
      if (prev.final) return false; // finals are locked: duplicates and late partials are ignored
      if (!ev.final && ev.rev <= prev.rev) return false; // stale or duplicate partial
    }
    u.byLang.set(ev.lang, ev);
    u.touchedAt = this.now();
    this.prune();
    return true;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttl * 4;
    for (const [uid, u] of this.utterances) if (u.touchedAt < cutoff) this.utterances.delete(uid);
    // Keep memory bounded on very long sessions.
    if (this.utterances.size > 200) {
      const oldest = [...this.utterances.values()].sort((a, b) => a.touchedAt - b.touchedAt).slice(0, this.utterances.size - 200);
      for (const u of oldest) this.utterances.delete(u.uid);
    }
  }

  /** Lines to draw now, oldest first, in the listener's chosen language. */
  visible(now: number = this.now()): CaptionLine[] {
    if (!this.isOn) return [];
    const lines: CaptionLine[] = [];
    for (const u of this.utterances.values()) {
      let ev = u.byLang.get(this.language);
      let original = false;
      if (!ev && this.showOriginal) {
        ev = u.byLang.get(u.src);
        original = Boolean(ev) && u.src !== this.language;
      }
      if (!ev || !ev.text) continue;
      const age = now - u.touchedAt;
      if (ev.final ? age > this.ttl : age > this.ttl * 2) continue;
      lines.push({
        uid: u.uid,
        speakerId: u.speaker.id,
        speakerName: u.speaker.name,
        text: ev.text,
        lang: ev.lang,
        final: ev.final,
        original,
        start: u.start,
        updatedAt: u.touchedAt,
      });
    }
    return lines.sort((a, b) => a.start - b.start || a.updatedAt - b.updatedAt).slice(-this.maxLines);
  }
}
