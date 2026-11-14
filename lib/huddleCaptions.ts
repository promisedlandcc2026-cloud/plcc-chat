/**
 * Live captions for the Live Huddle.
 *
 * Each person's own browser turns *their* speech into text (the Web Speech API
 * built into Chrome, Edge and Safari) while their mic is on, and sends the text
 * to the room over the LiveKit data channel. Everyone who turns captions on sees
 * them. No server, no key, no cost. Browsers without speech recognition (e.g.
 * Firefox) can still read everyone else's captions.
 */

export const HUDDLE_CAPTION_TOPIC = 'plcc.huddle.captions';
/** How long a finished line stays on screen after the speaker stops. */
export const CAPTION_LINE_TTL_MS = 7000;
export const CAPTION_MAX_CHARS = 280;
/** At most this many speakers' lines on screen at once. */
export const CAPTION_MAX_LINES = 3;

export type CaptionLanguage = 'en' | 'sw' | 'lg';

export const CAPTION_LANGUAGES: { code: CaptionLanguage; label: string; note?: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'lg', label: 'Luganda', note: 'trial' },
];

/** Recognition locales to try, best first (East African English, then others). */
const LOCALE_CHAIN: Record<CaptionLanguage, string[]> = {
  en: ['en-KE', 'en-GB', 'en-US'],
  sw: ['sw-KE', 'sw-TZ', 'sw'],
  lg: ['lg-UG', 'lg'],
};

export function localeChain(lang: CaptionLanguage): string[] {
  return LOCALE_CHAIN[lang] ?? LOCALE_CHAIN.en;
}

export type CaptionWire =
  | { v: 1; t: 'on' }
  | { v: 1; t: 'line'; id: string; text: string; final: boolean; lang: CaptionLanguage };

export function encodeCaptionWire(wire: CaptionWire): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(wire));
}

/** Validates an incoming caption message; anything unexpected is dropped. */
export function decodeCaptionWire(bytes: Uint8Array): CaptionWire | null {
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    if (!raw || raw.v !== 1) return null;
    if (raw.t === 'on') return { v: 1, t: 'on' };
    if (raw.t !== 'line') return null;
    const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, CAPTION_MAX_CHARS) : '';
    const id = typeof raw.id === 'string' ? raw.id.slice(0, 64) : '';
    const lang: CaptionLanguage = raw.lang === 'sw' || raw.lang === 'lg' ? raw.lang : 'en';
    if (!id) return null;
    return { v: 1, t: 'line', id, text, final: Boolean(raw.final), lang };
  } catch {
    return null;
  }
}

export type CaptionLine = {
  identity: string;
  name: string;
  isLocal: boolean;
  id: string;
  text: string;
  final: boolean;
  at: number;
};

/** Latest line per speaker; an empty text clears that speaker. */
export function upsertCaption(
  lines: Record<string, CaptionLine>,
  line: CaptionLine
): Record<string, CaptionLine> {
  const next = { ...lines };
  if (!line.text) delete next[line.identity];
  else next[line.identity] = line;
  return next;
}

/** Lines to show now: most recent speakers first, finished lines expire. */
export function visibleCaptions(lines: Record<string, CaptionLine>, now: number): CaptionLine[] {
  return Object.values(lines)
    .filter((l) => l.text && (!l.final || now - l.at < CAPTION_LINE_TTL_MS) && now - l.at < CAPTION_LINE_TTL_MS * 3)
    .sort((a, b) => b.at - a.at)
    .slice(0, CAPTION_MAX_LINES)
    .reverse();
}

/* ── Speech recognition (browser) ─────────────────────────────────────────── */

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => RecognitionLike) | null;
}

export function speechCaptionsSupported(): boolean {
  return Boolean(recognitionCtor());
}

export type CaptionRecognizerError = 'not-supported' | 'language-not-supported' | 'not-allowed' | 'network';

/**
 * Turns this person's speech into caption text. Chrome ends recognition after a
 * pause, so it restarts itself until stop(). If a locale is unsupported it tries
 * the next one in the chain.
 */
export class CaptionRecognizer {
  private recognition: RecognitionLike | null = null;
  private active = false;
  private chain: string[] = [];
  private chainIndex = 0;
  private restarts = 0;
  private lineSeq = 0;
  private currentId = '';

  constructor(
    private readonly onText: (line: { id: string; text: string; final: boolean }) => void,
    private readonly onError: (error: CaptionRecognizerError) => void
  ) {}

  start(lang: CaptionLanguage): void {
    this.stop();
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.onError('not-supported');
      return;
    }
    this.active = true;
    this.chain = localeChain(lang);
    this.chainIndex = 0;
    this.restarts = 0;
    this.spawn(Ctor);
  }

  stop(): void {
    this.active = false;
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
    if (this.currentId) {
      this.onText({ id: this.currentId, text: '', final: true });
      this.currentId = '';
    }
  }

  private spawn(Ctor: new () => RecognitionLike): void {
    if (!this.active) return;
    const rec = new Ctor();
    rec.lang = this.chain[this.chainIndex] || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      this.restarts = 0;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = String(result?.[0]?.transcript || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (!this.currentId) this.currentId = `c${Date.now().toString(36)}${(this.lineSeq += 1)}`;
        this.onText({ id: this.currentId, text: text.slice(-CAPTION_MAX_CHARS), final: Boolean(result.isFinal) });
        if (result.isFinal) this.currentId = '';
      }
    };
    rec.onerror = (event: any) => {
      const code = String(event?.error || '');
      if (code === 'language-not-supported' || code === 'bad-grammar') {
        if (this.chainIndex < this.chain.length - 1) {
          this.chainIndex += 1;
          return; // onend respawns with the next locale
        }
        this.active = false;
        this.onError('language-not-supported');
      } else if (code === 'not-allowed' || code === 'service-not-allowed') {
        this.active = false;
        this.onError('not-allowed');
      } else if (code === 'network') {
        this.onError('network');
      }
      // 'no-speech' and 'aborted' are normal: onend restarts.
    };
    rec.onend = () => {
      if (!this.active) return;
      this.restarts += 1;
      // Back off gently if the browser keeps ending straight away.
      const wait = this.restarts > 5 ? Math.min(5000, this.restarts * 400) : 150;
      window.setTimeout(() => {
        if (this.active && this.recognition === rec) this.spawn(Ctor);
      }, wait);
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() throws if a previous session is still closing; onend will retry.
    }
  }
}
