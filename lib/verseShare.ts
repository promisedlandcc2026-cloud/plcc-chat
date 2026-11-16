/**
 * Bible verses shared from the church Bible reader (website /bible).
 * The share link carries only the passage; the wording is fetched from the
 * website so a "verse" can't be made up in a link.
 *
 * Message format (plain text, so it still reads well anywhere):
 *   <personal message, optional>
 *
 *   📖 John 1:10–11 · KJV
 *   “He was in the world…”
 *   https://sanctum-live-nine.vercel.app/bible?t=eng_kjv&b=JHN&c=1&v=10-11
 */

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
export const SITE_ORIGIN = String(env.VITE_SITE_ORIGIN || 'https://sanctum-live-nine.vercel.app').replace(/\/+$/, '');
const SITE_HOSTS = new Set([new URL(SITE_ORIGIN).host, 'sanctum-live-nine.vercel.app']);
export const VERSE_MARK = '📖 ';
const MAX_TEXT = 1800;

export type VersePassage = { t: string; b: string; c: number; from?: number; to?: number };
export type SharedVerse = { ref: string; translation: string; text: string; url: string };

export function passageFromParams(params: URLSearchParams): VersePassage | null {
  const t = String(params.get('t') || '');
  const b = String(params.get('b') || '').toUpperCase();
  const c = Number.parseInt(String(params.get('c') || ''), 10);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(t) || !/^[0-9A-Z]{3}$/.test(b) || !Number.isFinite(c) || c < 1 || c > 200) return null;
  const [rawFrom, rawTo] = String(params.get('v') || '').split('-').map((n) => Number.parseInt(n, 10));
  const from = Number.isFinite(rawFrom) && rawFrom > 0 && rawFrom < 200 ? rawFrom : undefined;
  const to = from && Number.isFinite(rawTo) && rawTo > from && rawTo < 200 ? Math.min(rawTo, from + 40) : from;
  return { t, b, c, from, to };
}

export function passageUrl(p: VersePassage): string {
  const v = p.from ? `&v=${p.from}${p.to && p.to > p.from ? `-${p.to}` : ''}` : '';
  return `${SITE_ORIGIN}/bible?t=${encodeURIComponent(p.t)}&b=${p.b}&c=${p.c}${v}`;
}

const shortLabel = (name: string, shortName: string, id: string) =>
  /king james/i.test(name) || /(^|_)kjv$/i.test(id) ? 'KJV' : shortName || id;

/** Loads the passage wording from the church Bible reader. */
export async function fetchVerse(p: VersePassage, signal?: AbortSignal): Promise<SharedVerse> {
  const res = await fetch(`${SITE_ORIGIN}/api/bible/chapter?t=${encodeURIComponent(p.t)}&b=${p.b}&c=${p.c}`, { signal });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    bookName?: string;
    translation?: { id: string; name: string; shortName: string };
    verses?: Record<string, string>;
  } | null;
  if (!res.ok || !data?.ok || !data.verses || !data.translation) throw new Error('Could not load that passage. Please try again.');
  const nums = p.from ? Array.from({ length: (p.to ?? p.from) - p.from + 1 }, (_, i) => p.from! + i) : Object.keys(data.verses).map(Number).slice(0, 3);
  let text = nums.map((n) => data.verses![String(n)] || '').filter(Boolean).join(' ').trim();
  if (!text) throw new Error('That verse isn’t in this translation.');
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT).replace(/\s+\S*$/, '')}…`;
  const range = p.from ? `:${p.from}${p.to && p.to > p.from ? `–${p.to}` : ''}` : '';
  return {
    ref: `${data.bookName || p.b} ${p.c}${range}`,
    translation: shortLabel(data.translation.name, data.translation.shortName, data.translation.id),
    text,
    url: passageUrl(p),
  };
}

export function buildVerseMessage(note: string, v: SharedVerse): string {
  const block = `${VERSE_MARK}${v.ref} · ${v.translation}\n“${v.text}”\n${v.url}`;
  const n = note.trim();
  return n ? `${n}\n\n${block}` : block;
}

/** Recognises a shared verse in a message; null for anything else. */
export function parseVerseMessage(content: string | null | undefined): (SharedVerse & { note: string }) | null {
  const text = String(content || '');
  const at = text.lastIndexOf(`\n${VERSE_MARK}`) >= 0 ? text.lastIndexOf(`\n${VERSE_MARK}`) + 1 : text.startsWith(VERSE_MARK) ? 0 : -1;
  if (at < 0) return null;
  const lines = text.slice(at).split('\n');
  if (lines.length < 3) return null;
  const head = lines[0].slice(VERSE_MARK.length);
  const url = lines[lines.length - 1].trim();
  const quote = lines.slice(1, -1).join('\n').trim();
  const sep = head.lastIndexOf(' · ');
  if (sep < 0 || !/^“[\s\S]*”$/.test(quote)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !SITE_HOSTS.has(u.host) || u.pathname !== '/bible') return null;
  } catch {
    return null;
  }
  return { note: text.slice(0, at).trim(), ref: head.slice(0, sep), translation: head.slice(sep + 3), text: quote.slice(1, -1), url };
}
