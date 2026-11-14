/**
 * Live huddle captions: wire format, on-screen lines, and the speech recognizer
 * (restart after pauses, locale fallback, unsupported Luganda).
 * Run: npx tsx scripts/huddle-captions-smoke.ts
 */
import {
  CAPTION_LINE_TTL_MS,
  CaptionRecognizer,
  decodeCaptionWire,
  encodeCaptionWire,
  localeChain,
  upsertCaption,
  visibleCaptions,
  type CaptionLine,
} from '../lib/huddleCaptions';

let failed = 0;
function check(label: string, ok: boolean) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'OK' : 'FAIL'}: ${label}`);
}

console.log('Wire format');
const line = decodeCaptionWire(encodeCaptionWire({ v: 1, t: 'line', id: 'c1', text: '  Praise   God  ', final: true, lang: 'sw' }));
check('round-trips a line and tidies spaces', line?.t === 'line' && line.text === 'Praise God' && line.lang === 'sw' && line.final);
check('round-trips "captions on"', decodeCaptionWire(encodeCaptionWire({ v: 1, t: 'on' }))?.t === 'on');
check('drops junk', decodeCaptionWire(new TextEncoder().encode('{"v":2}')) === null);
check('drops non-JSON', decodeCaptionWire(new TextEncoder().encode('hello')) === null);
check('caps long text', (decodeCaptionWire(encodeCaptionWire({ v: 1, t: 'line', id: 'x', text: 'a'.repeat(999), final: false, lang: 'en' })) as any).text.length === 280);
check('unknown language becomes English', (decodeCaptionWire(new TextEncoder().encode('{"v":1,"t":"line","id":"a","text":"hi","lang":"zz"}')) as any).lang === 'en');

console.log('On-screen lines');
const base = 1_000_000;
const mk = (identity: string, text: string, final: boolean, at: number): CaptionLine => ({ identity, name: identity, isLocal: false, id: identity + at, text, final, at });
let lines: Record<string, CaptionLine> = {};
lines = upsertCaption(lines, mk('a', 'Good morning', false, base));
lines = upsertCaption(lines, mk('a', 'Good morning church', true, base + 500));
lines = upsertCaption(lines, mk('b', 'Amen', true, base + 1000));
check('one line per speaker (latest wins)', Object.keys(lines).length === 2 && lines.a.text === 'Good morning church');
check('both visible now, oldest first', visibleCaptions(lines, base + 1200).map((l) => l.identity).join() === 'a,b');
check('finished lines expire', visibleCaptions(lines, base + 1000 + CAPTION_LINE_TTL_MS + 1).length === 0);
lines = upsertCaption(lines, mk('b', '', true, base + 2000));
check('empty text clears a speaker', !lines.b);
for (const id of ['c', 'd', 'e', 'f']) lines = upsertCaption(lines, mk(id, 'hi', false, base + 3000 + id.charCodeAt(0)));
check('at most 3 speakers on screen', visibleCaptions(lines, base + 3200).length === 3);

console.log('Recognizer');
check('English tries East African English first', localeChain('en')[0] === 'en-KE');
check('Luganda chain', localeChain('lg').join() === 'lg-UG,lg');

type Fake = { lang: string; started: number; onresult: any; onerror: any; onend: any; start(): void; stop(): void; abort(): void };
const made: Fake[] = [];
const unsupported = new Set<string>();
class FakeRecognition implements Fake {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  started = 0;
  onresult: any = null;
  onerror: any = null;
  onend: any = null;
  constructor() {
    made.push(this);
  }
  start() {
    this.started += 1;
    if (unsupported.has(this.lang)) {
      this.onerror?.({ error: 'language-not-supported' });
      this.onend?.();
    }
  }
  stop() {
    this.onend?.();
  }
  abort() {}
}
const timers: Array<() => void> = [];
(globalThis as any).window = { webkitSpeechRecognition: FakeRecognition, setTimeout: (fn: () => void) => timers.push(fn) };
const flush = () => {
  while (timers.length) timers.shift()!();
};

const got: { id: string; text: string; final: boolean }[] = [];
const errors: string[] = [];
const rec = new CaptionRecognizer((l) => got.push(l), (e) => errors.push(e));
rec.start('en');
check('starts with en-KE', made[0]?.lang === 'en-KE' && made[0].started === 1);
made[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Let us' }], { isFinal: false })] });
made[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Let us pray' }], { isFinal: true })] });
check('sends words in progress, then the finished line (same id)', got.length === 2 && !got[0].final && got[1].final && got[0].id === got[1].id && got[1].text === 'Let us pray');
made[0].onend();
flush();
check('restarts by itself after a pause', made.length === 2 && made[1].lang === 'en-KE');
made[1].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Amen' }], { isFinal: true })] });
check('next line gets a new id', got[2].id !== got[1].id);
rec.stop();
made[1].onend?.();
flush();
check('stop() ends it (no restart)', made.length === 2);

unsupported.add('lg-UG');
unsupported.add('lg');
const rec2 = new CaptionRecognizer(() => undefined, (e) => errors.push(e));
const before = made.length;
rec2.start('lg');
flush();
check('tries lg-UG then lg', made.slice(before).map((m) => m.lang).join() === 'lg-UG,lg');
check('reports Luganda unavailable', errors.includes('language-not-supported'));

unsupported.clear();
unsupported.add('sw-KE');
const rec3 = new CaptionRecognizer(() => undefined, () => undefined);
const before3 = made.length;
rec3.start('sw');
flush();
check('falls back sw-KE → sw-TZ', made.slice(before3).map((m) => m.lang).join() === 'sw-KE,sw-TZ');
rec3.stop();

if (failed) {
  console.error(`\n${failed} caption check(s) failed.`);
  process.exit(1);
}
console.log('\nAll live caption checks passed.');
