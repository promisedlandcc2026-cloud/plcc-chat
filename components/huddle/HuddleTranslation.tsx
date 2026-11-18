/**
 * Ka Link live translation (PLCC Live Translation worker).
 *
 * Members: tap "Translate", pick English or Luganda, and translated captions appear on their own
 * screen. Nothing is sent from a member's device; the captions arrive from the translation worker
 * through LiveKit's server API and are accepted only if they really came from the server
 * (isTrustedTranslationPacket).
 *
 * Host / co-host: picks the language being preached and switches translation on or off. That sets
 * an attribute on the host's own participant (plcc.translate). The worker honours it only for the
 * huddle's host/co-hosts in Canaan's room metadata. Switching on also wakes the translator, which
 * sleeps (costs nothing) when unused; captions start about a minute later the first time.
 */
import { Languages, X } from 'lucide-react';
import { RoomEvent, type Participant, type Room } from 'livekit-client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptionStore, type CaptionLine } from '../../lib/translation/captionStore';
import { decodeEvent, isTrustedTranslationPacket, TRANSLATION_TOPIC } from '../../lib/translation/protocol';
import {
  HOST_TRANSLATE_ATTRIBUTE,
  isHuddleHostOrCoHost,
  TRANSLATION_LANGUAGES,
  translateAttributeValue,
  type TranslationLang,
} from '../../lib/translation/hostSwitch';
import { wakeTranslator } from '../../lib/translation/wake';

const LANG_PREF_KEY = 'plcc_ka_link_translate_lang';

function readLangPref(): TranslationLang | null {
  try {
    const v = window.localStorage.getItem(LANG_PREF_KEY);
    return TRANSLATION_LANGUAGES.some((l) => l.code === v) ? (v as TranslationLang) : null;
  } catch {
    return null;
  }
}

function writeLangPref(v: TranslationLang): void {
  try {
    window.localStorage.setItem(LANG_PREF_KEY, v);
  } catch {
    /* private mode */
  }
}

export interface HuddleTranslationState {
  /** Translation running in this huddle (the worker said so). */
  live: boolean;
  /** This member's caption panel is open. */
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  language: TranslationLang;
  setLanguage: (l: TranslationLang) => void;
  lines: CaptionLine[];
  sourceLanguage: string | null;
  notice: string | null;
  /** Local person is the huddle host or a co-host. */
  canControl: boolean;
  /** Host switch is on (local request). */
  hostOn: boolean;
  hostLanguage: TranslationLang;
  starting: boolean;
  hostError: string | null;
  switchOn: (src: TranslationLang) => Promise<void>;
  switchOff: () => Promise<void>;
}

export function useHuddleTranslation(room: Room | null, connected: boolean): HuddleTranslationState {
  const [language, setLanguageState] = useState<TranslationLang>(() => readLangPref() ?? 'en');
  const storeRef = useRef<CaptionStore | null>(null);
  if (!storeRef.current) storeRef.current = new CaptionStore({ language, maxLines: 3, lineTtlMs: 12000 });
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [canControl, setCanControl] = useState(false);
  const [hostOn, setHostOn] = useState(false);
  const [hostLanguage, setHostLanguage] = useState<TranslationLang>('en');
  const [starting, setStarting] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!room || !connected) return undefined;
    const store = storeRef.current!;
    const onData = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (!isTrustedTranslationPacket(topic, participant?.identity)) return;
      const ev = decodeEvent(payload);
      if (ev && store.apply(ev)) bump();
    };
    const refreshRole = () => setCanControl(isHuddleHostOrCoHost(room.metadata, room.localParticipant.identity));
    refreshRole();
    room.on(RoomEvent.DataReceived, onData).on(RoomEvent.RoomMetadataChanged, refreshRole);
    const tick = window.setInterval(bump, 2000); // let finished lines fade
    return () => {
      room.off(RoomEvent.DataReceived, onData).off(RoomEvent.RoomMetadataChanged, refreshRole);
      window.clearInterval(tick);
    };
  }, [room, connected, bump]);

  const store = storeRef.current;
  const live = store.isOn;
  useEffect(() => {
    if (live) setStarting(false);
  }, [live]);

  const setLanguage = useCallback(
    (l: TranslationLang) => {
      setLanguageState(l);
      writeLangPref(l);
      storeRef.current?.setLanguage(l);
      bump();
    },
    [bump]
  );

  const switchOn = useCallback(
    async (src: TranslationLang) => {
      if (!room) return;
      setHostError(null);
      setStarting(true);
      setHostLanguage(src);
      try {
        await room.localParticipant.setAttributes({ [HOST_TRANSLATE_ATTRIBUTE]: translateAttributeValue(true, src) });
        setHostOn(true);
        const woke = await wakeTranslator();
        if (woke.ok === false) setHostError(woke.message);
      } catch {
        setStarting(false);
        setHostError('Could not switch translation on. Check your connection and try again.');
      }
    },
    [room]
  );

  const switchOff = useCallback(async () => {
    if (!room) return;
    setHostError(null);
    try {
      await room.localParticipant.setAttributes({ [HOST_TRANSLATE_ATTRIBUTE]: translateAttributeValue(false) });
      setHostOn(false);
      setStarting(false);
    } catch {
      setHostError('Could not switch translation off. Try again.');
    }
  }, [room]);

  const lines = useMemo(() => store.visible(Date.now()), [store, version]);
  return {
    live,
    open,
    setOpen,
    language,
    setLanguage,
    lines,
    sourceLanguage: store.status?.src ?? null,
    notice: live ? store.status?.notice ?? null : null,
    canControl,
    hostOn,
    hostLanguage,
    starting,
    hostError,
    switchOn,
    switchOff,
  };
}

/** Round "Translate" button for the call controls. `variant` matches the two Ka Link layouts. */
export function TranslateButton({ t, variant }: { t: HuddleTranslationState; variant: 'room' | 'mobile' }) {
  const active = t.open;
  const cls =
    variant === 'room'
      ? `pr-tool is-icon ${active ? 'is-on' : ''}`
      : `relative min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center ${
          active ? 'bg-gold text-burgundy' : 'bg-white/10 text-white'
        }`;
  return (
    <button
      type="button"
      onClick={() => t.setOpen((v) => !v)}
      className={cls}
      aria-label={active ? 'Hide translation' : 'Translate'}
      aria-pressed={active}
      title="Translate"
      data-testid="huddle-translate-toggle"
    >
      <Languages size={variant === 'room' ? 18 : 22} aria-hidden />
      {t.live && !active ? (
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-black" aria-hidden />
      ) : null}
    </button>
  );
}

const LANG_LABEL: Record<string, string> = Object.fromEntries(TRANSLATION_LANGUAGES.map((l) => [l.code, l.label]));

/** Caption panel: language choice for everyone, plus the host's switch. */
export function TranslationPanel({ t }: { t: HuddleTranslationState }) {
  if (!t.open) return null;
  return (
    <section
      aria-label="Live translation"
      className="max-w-3xl mx-auto w-full rounded-2xl bg-black/75 border border-white/10 px-3 py-2.5 text-white"
      data-testid="huddle-translation"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gold">
          Translation {t.live ? <span className="ml-1 text-emerald-300">● on</span> : null}
        </p>
        <div className="flex items-center gap-1.5" role="group" aria-label="Show captions in">
          {TRANSLATION_LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => t.setLanguage(l.code)}
              aria-pressed={t.language === l.code}
              className={`min-h-[36px] rounded-full px-3 text-xs font-bold ${
                t.language === l.code ? 'bg-gold text-burgundy' : 'bg-white/10 text-white'
              }`}
            >
              {l.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => t.setOpen(false)}
            className="min-h-[36px] min-w-[36px] rounded-full bg-white/10 flex items-center justify-center"
            aria-label="Close translation"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>

      {t.canControl ? (
        <div className="mb-2 rounded-xl bg-white/5 px-2.5 py-2" data-testid="huddle-translation-host">
          <p className="text-xs font-bold text-white/80 mb-1.5">Host: the preacher is speaking</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {TRANSLATION_LANGUAGES.map((l) => {
              const on = t.hostOn && t.hostLanguage === l.code;
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => void t.switchOn(l.code)}
                  aria-pressed={on}
                  className={`min-h-[36px] rounded-full px-3 text-xs font-bold ${on ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white'}`}
                >
                  {l.label}
                </button>
              );
            })}
            {t.hostOn ? (
              <button
                type="button"
                onClick={() => void t.switchOff()}
                className="min-h-[36px] rounded-full px-3 text-xs font-bold bg-burgundy text-white"
              >
                Stop translation
              </button>
            ) : null}
          </div>
          {t.starting && !t.live ? (
            <p className="mt-1.5 text-xs text-gold/90">Starting the translator… captions begin in about a minute.</p>
          ) : null}
          {t.hostError ? <p className="mt-1.5 text-xs text-red-300">{t.hostError}</p> : null}
        </div>
      ) : null}

      <div aria-live="polite" className="min-h-[2.75rem] space-y-1">
        {t.lines.length ? (
          t.lines.map((line) => (
            <p key={line.uid} className="text-base sm:text-lg leading-snug">
              <span className="font-bold text-gold text-sm">{line.speakerName}: </span>
              <span className={line.final ? '' : 'text-white/80'}>{line.text}</span>
              {line.original ? <span className="ml-1 text-[11px] text-white/50">({LANG_LABEL[line.lang] ?? line.lang}, translating…)</span> : null}
            </p>
          ))
        ) : (
          <p className="text-sm text-white/55">
            {t.live
              ? 'Waiting for the preacher to speak…'
              : t.canControl
                ? 'Choose the language being preached to switch translation on for everyone.'
                : 'Captions appear here when the host switches translation on.'}
          </p>
        )}
      </div>
      {t.notice ? <p className="mt-1.5 text-[11px] text-white/50">{t.notice}</p> : null}
    </section>
  );
}
