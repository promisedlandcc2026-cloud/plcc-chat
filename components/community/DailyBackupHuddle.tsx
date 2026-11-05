/**
 * Live Huddle on the backup line (Daily), used when LiveKit is out of minutes.
 * Mirrors PLCC Canaan's in-page Daily huddle: audio first, who's here, mute,
 * raise hand (same `awc.huddle.hand` app message as Vault), and leave.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import DailyIframe, { type DailyCall, type DailyParticipant } from '@daily-co/daily-js';
import { Hand, Loader2, Mic, MicOff, PhoneOff, Volume2, X } from 'lucide-react';
import { useScreenWakeLock } from '../../lib/useScreenWakeLock';
import type { DailyCredentials } from '../../lib/huddleFailsafe';

type Person = {
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  handRaised: boolean;
  raisedAt: number | null;
};

type HandMessage = { type: 'awc.huddle.hand'; identity: string; raised: boolean; raisedAt: number | null };

export function isHandMessage(data: unknown): data is HandMessage {
  if (!data || typeof data !== 'object') return false;
  const row = data as { type?: string; identity?: string };
  return row.type === 'awc.huddle.hand' && Boolean(String(row.identity || '').trim());
}

type Props = {
  creds: DailyCredentials;
  title: string;
  onClose: () => void;
  /** Show inside a panel (Prayer Watch) instead of full screen. */
  embedded?: boolean;
};

export const DailyBackupHuddle: React.FC<Props> = ({ creds, title, onClose, embedded = false }) => {
  const [state, setState] = useState<'connecting' | 'connected' | 'reconnecting' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [muted, setMuted] = useState(true);
  const [needSoundTap, setNeedSoundTap] = useState(false);

  const callRef = useRef<DailyCall | null>(null);
  const handsRef = useRef<Map<string, { raised: boolean; raisedAt: number | null }>>(new Map());
  const audioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const speakingRef = useRef('');
  const leavingRef = useRef(false);

  useScreenWakeLock(state === 'connected' || state === 'connecting' || state === 'reconnecting');

  const syncAudio = useCallback((call: DailyCall) => {
    const participants = call.participants() as Record<string, DailyParticipant>;
    const present = new Set<string>();
    for (const p of Object.values(participants)) {
      if (p.local) continue;
      const id = String(p.session_id || '');
      const track = p.tracks?.audio?.persistentTrack || p.tracks?.audio?.track || null;
      if (!id || !track) continue;
      present.add(id);
      let el = audioRef.current.get(id);
      if (!el) {
        el = new Audio();
        el.autoplay = true;
        audioRef.current.set(id, el);
      }
      const current = el.srcObject as MediaStream | null;
      if (!current || current.getAudioTracks()[0]?.id !== track.id) {
        el.srcObject = new MediaStream([track]);
        el.play().catch(() => setNeedSoundTap(true));
      }
    }
    for (const [id, el] of audioRef.current) {
      if (!present.has(id)) {
        el.pause();
        el.srcObject = null;
        audioRef.current.delete(id);
      }
    }
  }, []);

  const publish = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const participants = call.participants() as Record<string, DailyParticipant>;
    const rows: Person[] = Object.values(participants).map((p) => {
      const identity = String(p.session_id || p.user_id || '');
      const hand = handsRef.current.get(identity);
      return {
        identity,
        name: String(p.user_name || 'Member'),
        isLocal: Boolean(p.local),
        isSpeaking: Boolean(speakingRef.current) && speakingRef.current === identity,
        isMuted: p.audio === false,
        handRaised: Boolean(hand?.raised),
        raisedAt: hand?.raised ? hand.raisedAt : null,
      };
    });
    rows.sort((a, b) => {
      if (a.handRaised !== b.handRaised) return a.handRaised ? -1 : 1;
      if (a.handRaised && b.handRaised) return (a.raisedAt ?? 0) - (b.raisedAt ?? 0);
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    setPeople(rows);
    syncAudio(call);
  }, [syncAudio]);

  useEffect(() => {
    let cancelled = false;
    const call = DailyIframe.createCallObject({
      subscribeToTracksAutomatically: true,
      audioSource: true,
      videoSource: false,
      startVideoOff: true,
    });
    callRef.current = call;

    call.on('joined-meeting', () => {
      setState('connected');
      publish();
    });
    call.on('participant-joined', publish);
    call.on('participant-updated', publish);
    call.on('participant-left', (ev) => {
      const id = String(ev?.participant?.session_id || '');
      if (id) handsRef.current.delete(id);
      publish();
    });
    call.on('track-started', publish);
    call.on('active-speaker-change', (ev) => {
      speakingRef.current = String(ev?.activeSpeaker?.peerId || '');
      publish();
    });
    call.on('network-connection', (ev) => {
      const name = String(ev?.event || '');
      if (name === 'interrupted') setState('reconnecting');
      if (name === 'connected') setState('connected');
    });
    call.on('app-message', (ev) => {
      if (!isHandMessage(ev?.data)) return;
      const msg = ev.data as HandMessage;
      if (msg.raised) handsRef.current.set(msg.identity, { raised: true, raisedAt: msg.raisedAt ?? Date.now() });
      else handsRef.current.delete(msg.identity);
      publish();
    });
    call.on('left-meeting', () => {
      if (!leavingRef.current) {
        setError('The backup line disconnected. Tap to rejoin.');
        setState('error');
      }
    });
    call.on('error', (ev) => {
      setError(ev?.errorMsg || 'The backup audio line disconnected.');
      setState('error');
    });

    void (async () => {
      try {
        await call.join({ url: creds.url, token: creds.token, startVideoOff: true, startAudioOff: true });
        if (cancelled) return;
        await call.setLocalAudio(false);
        setMuted(true);
        publish();
      } catch (err) {
        if (cancelled) return;
        const msg = String((err as { message?: string })?.message || '');
        setError(
          /permission|notallowed|denied/i.test(msg)
            ? 'Allow microphone access for PLCC Chat, then try again.'
            : 'Could not join the backup line. Please try again.'
        );
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
      leavingRef.current = true;
      for (const el of audioRef.current.values()) {
        el.pause();
        el.srcObject = null;
      }
      audioRef.current.clear();
      callRef.current = null;
      void call.leave().catch(() => undefined).finally(() => void call.destroy().catch(() => undefined));
    };
  }, [creds.token, creds.url, publish]);

  const me = people.find((p) => p.isLocal) || null;

  const toggleMute = async () => {
    const call = callRef.current;
    if (!call) return;
    const next = !muted;
    call.setLocalAudio(!next);
    setMuted(next);
  };

  const toggleHand = () => {
    const call = callRef.current;
    if (!call || !me) return;
    const raised = !me.handRaised;
    const raisedAt = raised ? Date.now() : null;
    const msg: HandMessage = { type: 'awc.huddle.hand', identity: me.identity, raised, raisedAt };
    if (raised) handsRef.current.set(me.identity, { raised: true, raisedAt });
    else handsRef.current.delete(me.identity);
    call.sendAppMessage(msg, '*');
    publish();
  };

  const enableSound = async () => {
    setNeedSoundTap(false);
    for (const el of audioRef.current.values()) {
      await el.play().catch(() => setNeedSoundTap(true));
    }
  };

  const leave = () => {
    leavingRef.current = true;
    onClose();
  };

  return (
    <div
      className={`${embedded ? 'relative h-full w-full z-0 overflow-hidden rounded-3xl' : 'fixed inset-0 z-[400]'} flex flex-col bg-[#0f0a0c] text-white`}
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label="Live Huddle on the backup line"
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 border-b border-white/10">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gold">Live Huddle · backup line</p>
          <h2 className="text-base font-bold truncate">{title}</h2>
        </div>
        <button
          type="button"
          onClick={leave}
          className="min-h-[44px] min-w-[44px] rounded-full bg-white/10 flex items-center justify-center"
          aria-label="Close huddle"
        >
          <X size={20} aria-hidden />
        </button>
      </header>

      <p className="mx-4 mt-3 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/85 leading-relaxed" role="note">
        Our main huddle line is busy, so you’re on the church’s backup line. Everyone in this huddle
        is here with you.
      </p>

      {needSoundTap ? (
        <button
          type="button"
          onClick={() => void enableSound()}
          className="mx-4 mt-3 flex items-center justify-center gap-2 rounded-2xl bg-gold text-burgundy font-bold text-sm min-h-[48px]"
        >
          <Volume2 size={18} aria-hidden />
          Enable sound
        </button>
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {state === 'connecting' ? (
          <p className="flex items-center justify-center gap-2 pt-10 text-white/80" role="status">
            <Loader2 className="animate-spin" size={18} aria-hidden /> Joining the backup line…
          </p>
        ) : null}
        {state === 'reconnecting' ? (
          <p className="mb-3 text-center text-sm text-gold" role="status">Reconnecting…</p>
        ) : null}
        {error ? (
          <p className="mb-3 text-center text-sm font-medium text-red-300" role="alert">{error}</p>
        ) : null}

        {people.length ? (
          <ul className="space-y-2" aria-label="People in this huddle">
            {people.map((p) => (
              <li
                key={p.identity}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${p.isSpeaking ? 'bg-gold/15 ring-1 ring-gold/60' : 'bg-white/5'}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-burgundy text-sm font-bold">
                  {p.name.trim().charAt(0).toUpperCase() || 'M'}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {p.name}
                  {p.isLocal ? <span className="ml-1.5 text-xs font-medium text-white/60">You</span> : null}
                </span>
                {p.handRaised ? <Hand size={18} className="text-gold" aria-label="Hand raised" /> : null}
                {p.isMuted ? <MicOff size={18} className="text-white/50" aria-label="Muted" /> : <Mic size={18} className="text-white/70" aria-label="Speaking allowed" />}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <footer className="flex items-center justify-center gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/10">
        <button
          type="button"
          onClick={() => void toggleMute()}
          disabled={state !== 'connected' && state !== 'reconnecting'}
          className={`min-h-[56px] min-w-[56px] rounded-2xl flex items-center justify-center disabled:opacity-40 ${muted ? 'bg-burgundy' : 'bg-white/15'}`}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={muted}
        >
          {muted ? <MicOff size={24} aria-hidden /> : <Mic size={24} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={toggleHand}
          disabled={!me}
          className={`min-h-[56px] min-w-[56px] rounded-2xl flex items-center justify-center disabled:opacity-40 ${me?.handRaised ? 'bg-gold text-burgundy' : 'bg-white/15'}`}
          aria-label={me?.handRaised ? 'Lower hand' : 'Raise hand'}
          aria-pressed={Boolean(me?.handRaised)}
        >
          <Hand size={24} aria-hidden />
        </button>
        <button
          type="button"
          onClick={leave}
          className="min-h-[56px] px-5 rounded-2xl bg-red-700 font-bold inline-flex items-center gap-2"
        >
          <PhoneOff size={20} aria-hidden /> Leave
        </button>
      </footer>
    </div>
  );
};
