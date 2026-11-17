/**
 * The church Bible (same Bibles as the website's /bible, including Bayibuli Entukuvu),
 * loaded from the website's public Bible API.
 */
import { SITE_ORIGIN } from './verseShare';

export type BibleTranslationInfo = {
  id: string;
  name: string;
  englishName: string;
  shortName: string;
  language: string;
  languageLabel: string;
  textDirection: 'ltr' | 'rtl';
  numberOfBooks: number;
  licenseNotice: string | null;
  source: { name: string; url: string } | null;
};
export type BibleBookInfo = { id: string; name: string; numberOfChapters: number };
export type BibleChapterText = { bookName: string; chapter: number; verses: Record<string, string> };

const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(path: string): Promise<T> {
  let pending = cache.get(path) as Promise<T> | undefined;
  if (!pending) {
    pending = fetch(`${SITE_ORIGIN}${path}`).then(async (res) => {
      const data = (await res.json().catch(() => null)) as ({ ok?: boolean } & T) | null;
      if (!res.ok || !data?.ok) throw new Error('The Bible could not be loaded. Check your connection and try again.');
      return data as T;
    });
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return pending;
}

export async function loadTranslations(): Promise<{ translations: BibleTranslationInfo[]; defaults: { english: string | null; luganda: string | null } }> {
  return getJson('/api/bible/translations');
}

export async function loadBooks(translationId: string): Promise<BibleBookInfo[]> {
  const data = await getJson<{ books: BibleBookInfo[] }>(`/api/bible/books?t=${encodeURIComponent(translationId)}`);
  return data.books;
}

export async function loadChapter(translationId: string, book: string, chapter: number): Promise<BibleChapterText> {
  return getJson(`/api/bible/chapter?t=${encodeURIComponent(translationId)}&b=${book}&c=${chapter}`);
}

/** The other language to show under each verse by default: English ↔ Luganda. */
export function pairedTranslation(
  main: BibleTranslationInfo | undefined,
  defaults: { english: string | null; luganda: string | null }
): string | null {
  if (!main) return null;
  if (main.language === 'eng') return defaults.luganda;
  if (main.language === 'lug') return defaults.english;
  return null;
}

/** "Yokaana 3:16" or "John 3:16–18" from a selection of verse numbers. */
export function selectionLabel(bookName: string, chapter: number, verses: number[]): string {
  if (!verses.length) return `${bookName} ${chapter}`;
  const from = Math.min(...verses);
  const to = Math.max(...verses);
  return `${bookName} ${chapter}:${from}${to > from ? `–${to}` : ''}`;
}
