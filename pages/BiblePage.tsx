import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Copy, Languages, Loader2, Send, Type, X } from 'lucide-react';
import { MemberPageHeader } from '../components/member/MemberPageHeader';
import {
  loadBooks,
  loadChapter,
  loadTranslations,
  pairedTranslation,
  selectionLabel,
  type BibleBookInfo,
  type BibleChapterText,
  type BibleTranslationInfo,
} from '../lib/bibleClient';

const SAVED_KEY = 'plcc_kalink_bible_v1';
const SIZES = ['text-[17px]', 'text-[19px]', 'text-[22px]'] as const;

type Saved = { t?: string; b?: string; c?: number; compare?: string | null; size?: number };

function readSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') as Saved;
  } catch {
    return {};
  }
}
function writeSaved(next: Saved) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ ...readSaved(), ...next }));
  } catch {
    /* private mode: fine */
  }
}

const selectClass =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-[15px] font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-burgundy/30';

/**
 * The church Bible inside PLCC Ka Link: the same Bibles as the website (Bayibuli Entukuvu,
 * King James and more), English and Luganda side by side, and "Share to chat".
 */
export const BiblePage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const saved = useMemo(readSaved, []);

  const [translations, setTranslations] = useState<BibleTranslationInfo[]>([]);
  const [defaults, setDefaults] = useState<{ english: string | null; luganda: string | null }>({ english: null, luganda: null });
  const [books, setBooks] = useState<BibleBookInfo[]>([]);
  const [chapter, setChapter] = useState<BibleChapterText | null>(null);
  const [second, setSecond] = useState<BibleChapterText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState<number>(saved.size ?? 0);

  const t = params.get('t') || saved.t || '';
  const b = (params.get('b') || saved.b || 'JHN').toUpperCase();
  const c = Number.parseInt(params.get('c') || String(saved.c || 1), 10) || 1;
  const [compareId, setCompareId] = useState<string | null | undefined>(saved.compare);

  const main = translations.find((x) => x.id === t);
  const book = books.find((x) => x.id === b);
  const compare = compareId === undefined ? pairedTranslation(main, defaults) : compareId;
  const compareInfo = translations.find((x) => x.id === compare);

  const go = (next: { t?: string; b?: string; c?: number }, opts?: { keepSelection?: boolean }) => {
    const p = new URLSearchParams();
    p.set('t', next.t ?? t);
    p.set('b', next.b ?? b);
    p.set('c', String(next.c ?? c));
    setParams(p, { replace: true });
    if (!opts?.keepSelection) setSelected([]);
  };

  // Bibles on offer; start in English (King James) unless the reader chose another before.
  useEffect(() => {
    let live = true;
    loadTranslations()
      .then((data) => {
        if (!live) return;
        setTranslations(data.translations);
        setDefaults(data.defaults);
        if (!data.translations.some((x) => x.id === t)) {
          const start = data.defaults.english || data.translations[0]?.id;
          if (start) go({ t: start });
        }
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Books of the chosen Bible.
  useEffect(() => {
    if (!main) return;
    let live = true;
    loadBooks(main.id)
      .then((list) => {
        if (!live) return;
        setBooks(list);
        const current = list.find((x) => x.id === b);
        if (!current) go({ b: list.find((x) => x.id === 'JHN')?.id || list[0]?.id || 'GEN', c: 1 });
        else if (c > current.numberOfChapters) go({ c: 1 });
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main?.id]);

  // The chapter, plus the same chapter in the second language.
  useEffect(() => {
    if (!main || !book) return;
    let live = true;
    setLoading(true);
    setError(null);
    writeSaved({ t: main.id, b: book.id, c });
    loadChapter(main.id, book.id, c)
      .then((data) => live && setChapter(data))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    window.scrollTo({ top: 0 });
    return () => {
      live = false;
    };
  }, [main, book, c]);

  useEffect(() => {
    setSecond(null);
    if (!compare || !book || compare === main?.id) return;
    let live = true;
    loadChapter(compare, book.id, c)
      .then((data) => live && setSecond(data))
      .catch(() => live && setSecond(null)); // e.g. a book this Bible doesn't have
    return () => {
      live = false;
    };
  }, [compare, book, c, main?.id]);

  const languages = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tr of translations) if (!seen.has(tr.language)) seen.set(tr.language, tr.languageLabel);
    return [...seen.entries()];
  }, [translations]);
  const inLanguage = translations.filter((x) => x.language === main?.language);

  const bookIndex = books.findIndex((x) => x.id === b);
  const prev = c > 1 ? { b, c: c - 1 } : bookIndex > 0 ? { b: books[bookIndex - 1].id, c: books[bookIndex - 1].numberOfChapters } : null;
  const next = book && c < book.numberOfChapters ? { b, c: c + 1 } : bookIndex >= 0 && bookIndex < books.length - 1 ? { b: books[bookIndex + 1].id, c: 1 } : null;

  const verses = chapter ? Object.entries(chapter.verses).map(([n, text]) => ({ n: Number(n), text })).sort((x, y) => x.n - y.n) : [];
  const bookName = chapter?.bookName || book?.name || b;
  const label = selectionLabel(bookName, c, selected);

  const toggleVerse = (n: number) => setSelected((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  const range = selected.length ? { from: Math.min(...selected), to: Math.max(...selected) } : null;

  const shareToChat = () => {
    if (!range || !main) return;
    const v = range.to > range.from ? `${range.from}-${range.to}` : String(range.from);
    navigate(`/share?kind=verse&t=${encodeURIComponent(main.id)}&b=${b}&c=${c}&v=${v}`);
  };
  const copySelection = async () => {
    if (!range || !main) return;
    const text = verses
      .filter((v) => v.n >= range.from && v.n <= range.to)
      .map((v) => v.text)
      .join(' ');
    try {
      await navigator.clipboard.writeText(`“${text}”\n— ${label} (${main.shortName || main.name})`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <main className="min-h-[100dvh] bg-eggshell pb-32">
      <div className="mx-auto max-w-3xl px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <MemberPageHeader
          title={main?.name || 'Bible'}
          eyebrow="The Bible"
          backTo="/community/chat"
          backLabel="Chats"
          subtitle={main && compareInfo ? `${main.languageLabel} with ${compareInfo.languageLabel} under each verse.` : undefined}
        />

        <section className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm" aria-label="Choose a passage">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gray-500">Language</span>
              <select
                className={selectClass}
                value={main?.language || ''}
                onChange={(e) => {
                  const lang = e.target.value;
                  const pick = translations.find((x) => x.language === lang && x.id === (lang === 'lug' ? defaults.luganda : lang === 'eng' ? defaults.english : x.id)) || translations.find((x) => x.language === lang);
                  if (pick) go({ t: pick.id });
                }}
              >
                {languages.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gray-500">Bible</span>
              <select className={selectClass} value={t} onChange={(e) => go({ t: e.target.value })}>
                {inLanguage.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gray-500">Book</span>
              <select className={selectClass} value={b} onChange={(e) => go({ b: e.target.value, c: 1 })}>
                {books.map((bk) => (
                  <option key={bk.id} value={bk.id}>{bk.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gray-500">Chapter</span>
              <select className={selectClass} value={c} onChange={(e) => go({ c: Number(e.target.value) })}>
                {Array.from({ length: book?.numberOfChapters || 1 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex min-h-[40px] flex-1 items-center gap-2 rounded-xl bg-gold-cream px-3 text-sm font-semibold text-ink">
              <Languages size={16} className="shrink-0 text-gold-ink" aria-hidden />
              <span className="shrink-0">Under each verse:</span>
              <select
                className="min-w-0 flex-1 bg-transparent font-bold focus:outline-none"
                value={compare || ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setCompareId(v);
                  writeSaved({ compare: v });
                }}
              >
                <option value="">Nothing</option>
                {translations.filter((x) => x.id !== t).map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.languageLabel} · {tr.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                const s = (size + 1) % SIZES.length;
                setSize(s);
                writeSaved({ size: s });
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-burgundy"
              aria-label="Change text size"
            >
              <Type size={16} aria-hidden /> Aa
            </button>
          </div>
        </section>

        <article className="mt-4 rounded-2xl border border-gray-100 bg-white px-4 py-5 shadow-sm sm:px-7" dir={main?.textDirection || 'ltr'} lang={main?.language === 'lug' ? 'lg' : undefined}>
          <h2 className="font-display text-[28px] font-bold leading-tight text-ink">
            {bookName} {c}
          </h2>
          {main ? <p className="mb-4 font-display text-[15px] italic text-burgundy">{main.name}</p> : null}

          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-3 text-sm font-semibold text-red-800" role="alert">{error}</p>
          ) : loading && !verses.length ? (
            <p className="flex items-center gap-2 py-10 text-gray-500" role="status">
              <Loader2 className="animate-spin text-burgundy" size={20} aria-hidden /> Loading…
            </p>
          ) : (
            <ol className={`space-y-1 ${loading ? 'opacity-60' : ''}`}>
              {verses.map((v) => {
                const on = selected.includes(v.n);
                const other = second?.verses[String(v.n)];
                return (
                  <li key={v.n}>
                    <button
                      type="button"
                      onClick={() => toggleVerse(v.n)}
                      aria-pressed={on}
                      className={`w-full rounded-xl px-2 py-1.5 text-left transition-colors ${on ? 'bg-gold/20 ring-1 ring-gold' : 'hover:bg-gold-cream/60'}`}
                    >
                      <span className={`font-display leading-relaxed text-ink ${SIZES[size]}`}>
                        <sup className="mr-1.5 font-sans text-[12px] font-bold text-gold-ink">{v.n}</sup>
                        {v.text}
                      </span>
                      {other ? (
                        <span
                          className="mt-1 block border-l-2 border-gold pl-3 text-[15px] leading-relaxed text-gray-600"
                          lang={compareInfo?.language === 'lug' ? 'lg' : undefined}
                          dir={compareInfo?.textDirection || 'ltr'}
                        >
                          {other}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <nav className="mt-6 flex items-center justify-between gap-2 border-t border-gray-100 pt-4" aria-label="Chapters">
            <button
              type="button"
              disabled={!prev}
              onClick={() => prev && go(prev)}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm font-bold text-burgundy disabled:opacity-40"
            >
              <ChevronLeft size={18} aria-hidden /> Previous
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() => next && go(next)}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-burgundy px-4 text-sm font-bold text-white disabled:opacity-40"
            >
              Next <ChevronRight size={18} aria-hidden />
            </button>
          </nav>

          {main ? (
            <p className="mt-5 text-[11px] leading-relaxed text-gray-500">
              {main.licenseNotice ? `${main.licenseNotice} ` : ''}
              Text courtesy of {main.source ? main.source.name : 'the Free Use Bible API'}.
              {compareInfo && compareInfo.licenseNotice ? ` ${compareInfo.licenseNotice}` : ''}
            </p>
          ) : null}
        </article>

        {!selected.length && verses.length ? (
          <p className="mt-3 text-center text-sm text-gray-500">Tap a verse to share it in a chat or copy it.</p>
        ) : null}
      </div>

      {selected.length ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/40 bg-burgundy px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-2xl">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-bold">{copied ? 'Copied' : label}</p>
            <button type="button" onClick={() => void copySelection()} aria-label={copied ? 'Copied' : 'Copy'} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-bold">
              <Copy size={16} aria-hidden /> <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button type="button" onClick={shareToChat} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gold px-4 text-sm font-bold text-burgundy-dark">
              <Send size={16} aria-hidden /> Share to chat
            </button>
            <button type="button" onClick={() => setSelected([])} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/10" aria-label="Clear selection">
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
};

export default BiblePage;
