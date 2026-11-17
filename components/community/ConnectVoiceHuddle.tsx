import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookHeart,
  RefreshCw,
  Captions,
  CircleHelp,
  Crown,
  HandHeart,
  Headphones,
  LayoutGrid,
  LogOut,
  Radio,
  Search,
  CaptionsOff,
  Hand,
  Info,
  Loader2,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Music,
  PhoneOff,
  Share2,
  ShieldCheck,
  Smile,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react';
import {
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type TrackPublication,
  DisconnectReason,
} from 'livekit-client';
import { CommunityChatError } from '../../lib/communityChatTypes';
import { endHuddle } from '../../lib/communityChatClient';
import { VAULT_URL } from '../../lib/appLinks';
import { GuidelinesSheet, PrayerRequestSheet } from './PrayerRoomSheets';
import { findSanctumOverflow, isRoomFullError, openSanctumOverflow, type SanctumOverflow } from '../../lib/sanctumOverflow';
import {
  claimHuddleLine,
  fetchDailyCredentials,
  fetchHuddleTokenResilient,
  planHuddleLine,
  rememberLiveKitQuota,
  type DailyCredentials,
} from '../../lib/huddleFailsafe';
import { connectLiveKitOnce, LiveKitQuotaError } from '../../lib/livekitConnect';
import {
  CAPTION_LANGUAGES,
  CaptionRecognizer,
  HUDDLE_CAPTION_TOPIC,
  decodeCaptionWire,
  encodeCaptionWire,
  speechCaptionsSupported,
  upsertCaption,
  visibleCaptions,
  type CaptionLanguage,
  type CaptionLine,
} from '../../lib/huddleCaptions';

const CAPTIONS_PREF_KEY = 'plcc_huddle_captions_v1';
const CAPTION_LANG_KEY = 'plcc_huddle_caption_lang_v1';

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
// Backup line (Daily SDK) downloads only when a huddle actually switches to it.
const DailyBackupHuddle = lazy(() =>
  import('./DailyBackupHuddle').then((m) => ({ default: m.DailyBackupHuddle }))
);
import {
  appendHuddleChatMessage,
  buildHuddleChatWirePayload,
  createHuddleChatId,
  decodeIncomingHuddleChat,
  encodeHuddleChatPayload,
  HUDDLE_CHAT_TOPIC,
  hydrateHuddleChatMessage,
  type HuddleChatMessage,
} from '../../lib/huddleChat';
import {
  HUDDLE_HOST_MUTE_NOTICE,
  huddleMicrophonePublishAllowed,
  mergeHandMetadata,
  parseHandRaised,
  sortTilesRaisedFirst,
  syncRosterFromTiles,
  type HuddleRosterEntry,
} from '../../lib/huddlePresence';
import {
  appendHuddleReactionEvent,
  buildHuddleReactionWirePayload,
  clearHuddleReactions,
  createHuddleReactionId,
  encodeHuddleReactionPayload,
  expireHuddleReactions,
  HUDDLE_REACTION_COOLDOWN_MS,
  HUDDLE_REACTION_OPTIONS,
  HUDDLE_REACTION_TOPIC,
  HUDDLE_REACTION_TTL_MS,
  hydrateHuddleReactionEvent,
  parseHuddleReactionWirePayload,
  shouldAllowHuddleReactionSend,
  type HuddleReactionEvent,
  type HuddleReactionKey,
} from '../../lib/huddleReaction';
import { useScreenWakeLock } from '../../lib/useScreenWakeLock';
import { HuddleChatPanel } from '../huddle/HuddleChatPanel';
import { HuddleHandsPanel } from '../huddle/HuddleHandsPanel';
import {
  HuddleMobileTabs,
  type HuddleMobileTabId,
} from '../huddle/HuddleMobileTabs';
import { HuddlePeoplePanel } from '../huddle/HuddlePeoplePanel';
import { HuddleTabSheet } from '../huddle/HuddleTabSheet';
import { VAULT_PUBLIC_ORIGIN } from '../../lib/staffVaultAccess';
import {
  canControlHuddleMusic,
  clampHuddleMusicVolume,
  formatHuddleMusicError,
  HUDDLE_MUSIC_ASSET_PATH,
  HUDDLE_MUSIC_DEFAULT_VOLUME,
  HUDDLE_MUSIC_MAX_VOLUME,
  HUDDLE_MUSIC_MIN_VOLUME,
  HUDDLE_MUSIC_TRACK_NAME,
  huddleMusicButtonLabel,
  huddleRemoteAudioKey,
  isHuddleMusicPublication,
  roomHasHuddleMusic,
} from '../../lib/huddleMusic';

/** LiveKit closed this copy on purpose (joined elsewhere, removed, or ended): do not auto-rejoin. */
function huddleDisconnectIsFinal(reason?: DisconnectReason): boolean {
  return (
    reason === DisconnectReason.DUPLICATE_IDENTITY ||
    reason === DisconnectReason.PARTICIPANT_REMOVED ||
    reason === DisconnectReason.ROOM_DELETED
  );
}

function huddleDisconnectMessage(reason?: DisconnectReason): string {
  if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
    return 'You joined this Ka Link somewhere else (another tab, app or device). Tap Join to bring it back here.';
  }
  if (reason === DisconnectReason.PARTICIPANT_REMOVED) return 'You were removed from the Ka Link.';
  return 'The Ka Link has ended.';
}

type ConnState = 'prejoin' | 'connecting' | 'reconnecting' | 'connected' | 'error';

const MAX_HUDDLE_RECONNECTS = 3;

type Tile = {
  identity: string;
  name: string;
  isLocal: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  speaking: boolean;
  /** Room moderator (from the LiveKit token's plcc.role attribute). */
  moderator: boolean;
};

type Props = {
  channelId: string;
  channelName?: string;
  /** start = first token mint; join = enter existing LIVE room */
  mode?: 'join' | 'start';
  onClose: () => void;
  /** Show inside a panel (Prayer Watch) instead of full screen. */
  embedded?: boolean;
  /** Voice only: no camera buttons (Intercessors' prayer calls). */
  audioOnly?: boolean;
  /** Prayer Watch: a simple prayer call — no Hand or Attendance (chat stays). */
  prayerWatch?: boolean;
};

function displayName(p: Participant): string {
  return (p.name || p.identity || 'Member').trim() || 'Member';
}

function ParticipantVideo({
  participant,
  isLocal,
  camOn,
}: {
  participant: Participant;
  isLocal: boolean;
  camOn: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!camOn) {
      el.srcObject = null;
      return undefined;
    }
    const pub = participant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;
    if (track && !pub.isMuted) {
      track.attach(el);
      return () => {
        track.detach(el);
      };
    }
    el.srcObject = null;
    return undefined;
  }, [participant, camOn, isLocal]);

  return (
    <video
      ref={videoRef}
      className={`absolute inset-0 z-0 h-full w-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
      playsInline
      muted={isLocal}
      autoPlay
    />
  );
}

type ScreenSharer = { identity: string; name: string; isLocal: boolean };

function screenShareSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/** The presenter's screen, shown large to everyone in the huddle (a preview for the presenter). */
function ScreenShareStage({ participant, sharer }: { participant: Participant; sharer: ScreenSharer }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const pub = participant.getTrackPublication(Track.Source.ScreenShare);
    const track = pub?.track;
    if (!track) return undefined;
    track.attach(el);
    el.muted = true; // the shared tab's sound plays through its own audio element
    return () => {
      try {
        track.detach(el);
      } catch {
        /* already gone */
      }
    };
  }, [participant, sharer.identity]);

  const label = sharer.isLocal ? 'You are sharing your screen' : `${sharer.name} is sharing their screen`;

  return (
    <section
      aria-label={label}
      className="max-w-5xl mx-auto rounded-2xl overflow-hidden border border-gold/40 bg-black"
      data-testid="huddle-screen-share"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[#0c110f]">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gold min-w-0">
          <Monitor size={14} aria-hidden className="shrink-0" />
          <span className="truncate">{label}</span>
        </p>
        <button
          type="button"
          onClick={() => {
            const el = frameRef.current;
            if (!el) return;
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            else void el.requestFullscreen?.().catch(() => undefined);
          }}
          className="min-h-[36px] min-w-[36px] rounded-xl bg-white/10 flex items-center justify-center text-white"
          aria-label="Full screen"
        >
          <Maximize2 size={16} aria-hidden />
        </button>
      </div>
      <div ref={frameRef} className="aspect-video w-full bg-black flex items-center justify-center">
        <video ref={videoRef} className="h-full w-full object-contain" playsInline muted autoPlay />
      </div>
    </section>
  );
}

export const ConnectVoiceHuddle: React.FC<Props> = ({
  channelId,
  channelName,
  mode = 'join',
  onClose,
  embedded = false,
  audioOnly = false,
  prayerWatch = false,
}) => {
  const shellClass = embedded ? 'relative h-full w-full z-0 overflow-hidden rounded-3xl' : 'fixed inset-0 z-[400]';
  const [conn, setConn] = useState<ConnState>('prejoin');
  const [error, setError] = useState<string | null>(null);
  /** Set when this huddle is on the backup line (Daily) — renders DailyBackupHuddle. */
  const [dailyCreds, setDailyCreds] = useState<DailyCredentials | null>(null);
  /** Calm status line for fail-safe moments (retrying, saved permission). */
  const [notice, setNotice] = useState<string | null>(null);
  const [hostMuteNotice, setHostMuteNotice] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  /** Screen share: who is presenting (one at a time), and our own share controls (moderators and up). */
  const [sharer, setSharer] = useState<ScreenSharer | null>(null);
  const [screenBusy, setScreenBusy] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  /** Live captions: whether I'm reading them, the language I speak, and the lines on screen. */
  const [captionsOn, setCaptionsOn] = useState<boolean>(() => readPref(CAPTIONS_PREF_KEY) === '1');
  const [captionLang, setCaptionLang] = useState<CaptionLanguage>(() => {
    const saved = readPref(CAPTION_LANG_KEY);
    return saved === 'sw' || saved === 'lg' ? saved : 'en';
  });
  /** Someone in the room wants captions, so my speech should be captioned too. */
  const [roomWantsCaptions, setRoomWantsCaptions] = useState(false);
  const [captionLines, setCaptionLines] = useState<Record<string, CaptionLine>>({});
  const [captionNotice, setCaptionNotice] = useState<string | null>(null);
  const [captionClock, setCaptionClock] = useState(() => Date.now());
  const captionsOnRef = useRef(captionsOn);
  const [needSoundTap, setNeedSoundTap] = useState(false);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [roster, setRoster] = useState<HuddleRosterEntry[]>([]);
  const [activeTab, setActiveTab] = useState<HuddleMobileTabId | null>(null);
  const [chatMessages, setChatMessages] = useState<HuddleChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatSending, setChatSending] = useState(false);
  const [title, setTitle] = useState(channelName || 'Live Ka Link');
  const [canModerate, setCanModerate] = useState(false);
  const [ending, setEnding] = useState(false);
  const [shareDone, setShareDone] = useState<string | null>(null);
  /** Full-screen prayer room: listen-only mode, sheets and participant search. */
  const [listenOnly, setListenOnly] = useState(false);
  /** Set when this room is at its 50-seat cap: offer PLCC Sanctum's overflow room. */
  const [roomFull, setRoomFull] = useState<{ checking: boolean; overflow: SanctumOverflow | null } | null>(null);
  const [sheet, setSheet] = useState<'prayer' | 'guidelines' | null>(null);
  const [peopleSearchOpen, setPeopleSearchOpen] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  /** This device is playing the waiting music into the room. */
  const [musicPlaying, setMusicPlaying] = useState(false);
  /** Someone (here or in the Vault) is playing music in this huddle. */
  const [musicActive, setMusicActive] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [musicVolume, setMusicVolume] = useState(HUDDLE_MUSIC_DEFAULT_VOLUME);
  // Ephemeral emoji reactions (same wire format as PLCC Canaan — not chat, nothing is saved).
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [activeReactions, setActiveReactions] = useState<HuddleReactionEvent[]>([]);
  const [reactionBusy, setReactionBusy] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [lastReactionSentAt, setLastReactionSentAt] = useState<number | null>(null);
  const ingestReactionRef = useRef<(rxn: HuddleReactionEvent) => void>(() => {});
  const reactionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** Share a one-tap join link for this huddle (native share sheet, else copy). */
  const shareHuddle = useCallback(async () => {
    // One link for both apps: the Vault's share page shows the WhatsApp card and opens
    // the Vault for signed-in staff, Tribes for everyone else — same live call.
    const url = `${VAULT_PUBLIC_ORIGIN}/api/share-huddle?channel=${encodeURIComponent(channelId)}`;
    const name = title || channelName || 'Live Ka Link';
    const text = `Join the "${name}" Live Ka Link. Sign in to Tribes or PLCC Canaan, then tap the link. It opens right into the prayer call:`;
    const flash = (msg: string) => {
      setShareDone(msg);
      window.setTimeout(() => setShareDone(null), 2000);
    };
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: name, text, url });
        return;
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      flash('Copied');
    } catch {
      window.prompt('Copy this link to share the Ka Link:', url);
    }
  }, [channelId, channelName, title]);

  const roomRef = useRef<Room | null>(null);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const joinInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const leaveIntentionalRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  /** True while connectLiveKitOnce runs — its own failures are handled by join(), not the reconnect loop. */
  const connectingRef = useRef(false);
  const joinRef = useRef<() => Promise<void>>(async () => {});
  /** Dropped while the phone slept or the member switched apps — rejoin when they're back. */
  const lostConnectionRef = useRef(false);
  const canModerateRef = useRef(false);
  const activeTabRef = useRef<HuddleMobileTabId | null>(null);
  const micEnabledRef = useRef(false);
  const selfMuteIntentRef = useRef(false);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicTrackRef = useRef<LocalAudioTrack | null>(null);
  /** Web Audio graph for music (iPhone Safari has no captureStream). */
  const musicCtxRef = useRef<AudioContext | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    canModerateRef.current = canModerate;
  }, [canModerate]);
  useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);
  useEffect(() => {
    activeTabRef.current = activeTab;
    if (activeTab === 'chat') setChatUnread(0);
  }, [activeTab]);

  useScreenWakeLock(
    conn === 'connected' || conn === 'connecting' || conn === 'reconnecting'
  );

  const clearRemoteAudio = useCallback(() => {
    for (const el of audioElsRef.current.values()) {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {
        /* ignore */
      }
    }
    audioElsRef.current.clear();
  }, []);

  const detachRemoteAudio = useCallback((key: string) => {
    const el = audioElsRef.current.get(key);
    if (!el) return;
    try {
      el.pause();
      el.srcObject = null;
      el.remove();
    } catch {
      /* ignore */
    }
    audioElsRef.current.delete(key);
  }, []);

  /** One audio element per track, so a host's voice and their music both play. */
  const attachRemoteAudio = useCallback((key: string, track: RemoteTrack) => {
    let el = audioElsRef.current.get(key);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', 'true');
      el.style.display = 'none';
      document.body.appendChild(el);
      audioElsRef.current.set(key, el);
    }
    track.attach(el);
    const play = el.play();
    if (play && typeof play.then === 'function') {
      play.catch(() => {
        if (mountedRef.current) setNeedSoundTap(true);
      });
    }
  }, []);

  const collectRoomPublications = (room: Room): TrackPublication[] => {
    const out: TrackPublication[] = [];
    room.localParticipant.trackPublications.forEach((pub) => out.push(pub));
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => out.push(pub));
    });
    return out;
  };

  /** Stop this device's waiting music and release the audio graph. */
  const stopHuddleMusic = useCallback(async () => {
    const room = roomRef.current;
    const localTrack = musicTrackRef.current;
    musicTrackRef.current = null;
    if (localTrack) {
      try {
        if (room) await room.localParticipant.unpublishTrack(localTrack, true);
        else localTrack.stop();
      } catch {
        try {
          localTrack.stop();
        } catch {
          /* ignore */
        }
      }
    }
    const audioEl = musicAudioRef.current;
    musicAudioRef.current = null;
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
      } catch {
        /* ignore */
      }
    }
    const ctx = musicCtxRef.current;
    musicCtxRef.current = null;
    musicGainRef.current = null;
    if (ctx) void ctx.close().catch(() => undefined);
    if (mountedRef.current) setMusicPlaying(false);
  }, []);

  const refreshTiles = useCallback((room: Room) => {
    if (!mountedRef.current) return;
    const speakers = new Set(room.activeSpeakers.map((p) => p.identity));
    const next: Tile[] = [];

    const push = (p: Participant, isLocal: boolean) => {
      const micPub = p.getTrackPublication(Track.Source.Microphone);
      const camPub = p.getTrackPublication(Track.Source.Camera);
      next.push({
        identity: p.identity,
        name: displayName(p),
        isLocal,
        micOn: Boolean(micPub?.track && !micPub.isMuted),
        camOn: Boolean(camPub?.track && !camPub.isMuted),
        handRaised: parseHandRaised(p.metadata),
        speaking: speakers.has(p.identity),
        moderator: p.attributes?.['plcc.role'] === 'moderator' || (isLocal && canModerateRef.current),
      });
    };

    push(room.localParticipant, true);
    const remotes = Array.from(room.remoteParticipants.values()).sort((a, b) =>
      displayName(a).localeCompare(displayName(b))
    );
    for (const r of remotes) push(r, false);
    const sorted = sortTilesRaisedFirst(next);
    setTiles(sorted);
    const isSharing = (p: Participant) => {
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
      return Boolean(pub?.track && !pub.isMuted);
    };
    const remoteSharer = remotes.find(isSharing);
    if (remoteSharer) {
      setSharer({ identity: remoteSharer.identity, name: displayName(remoteSharer), isLocal: false });
    } else if (isSharing(room.localParticipant)) {
      setSharer({ identity: room.localParticipant.identity, name: displayName(room.localParticipant), isLocal: true });
    } else {
      setSharer(null);
    }
    setMusicActive(roomHasHuddleMusic(collectRoomPublications(room)));
    setRoster((prev) => syncRosterFromTiles(prev, sorted));
  }, []);

  const disconnectRoom = useCallback(async () => {
    // Stop music while roomRef still points at the live room (unpublish needs it).
    await stopHuddleMusic();
    const room = roomRef.current;
    roomRef.current = null;
    if (mountedRef.current) {
      setMusicActive(false);
      setMusicError(null);
    }
    clearRemoteAudio();
    if (room) {
      try {
        await room.disconnect(true);
      } catch {
        /* ignore */
      }
    }
  }, [clearRemoteAudio, stopHuddleMusic]);

  const canPlayHuddleMusic = canControlHuddleMusic(canModerate) && !prayerWatch;

  const toggleHuddleMusic = useCallback(async () => {
    if (!canControlHuddleMusic(canModerateRef.current)) return;
    const room = roomRef.current;
    if (!room) return;
    setMusicBusy(true);
    setMusicError(null);
    try {
      if (musicPlaying) {
        await stopHuddleMusic();
        setMusicActive(roomHasHuddleMusic(collectRoomPublications(room)));
        return;
      }
      if (roomHasHuddleMusic(collectRoomPublications(room))) {
        throw new Error('Music is already playing.');
      }
      const audioEl = new Audio(HUDDLE_MUSIC_ASSET_PATH);
      audioEl.loop = true;
      audioEl.volume = musicVolume;
      audioEl.preload = 'auto';
      audioEl.setAttribute('playsinline', '');
      musicAudioRef.current = audioEl;

      /*
       * Route the music through Web Audio and send that stream to the room.
       * iPhone/iPad Safari has no captureStream, so this is the path that works
       * there. The AudioContext and play() start before any await, so iOS still
       * counts the tap.
       */
      type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
      const Ctx = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      let mediaTrack: MediaStreamTrack | null = null;
      if (Ctx) {
        try {
          const ctx = new Ctx();
          const source = ctx.createMediaElementSource(audioEl);
          const gain = ctx.createGain();
          gain.gain.value = musicVolume;
          const dest = ctx.createMediaStreamDestination();
          source.connect(gain);
          gain.connect(dest); // what the room hears
          gain.connect(ctx.destination); // so the host hears it too
          musicCtxRef.current = ctx;
          musicGainRef.current = gain;
          audioEl.volume = 1; // level comes from the gain node (iOS ignores element volume)
          void ctx.resume().catch(() => undefined);
          mediaTrack = dest.stream.getAudioTracks()[0] || null;
        } catch {
          mediaTrack = null;
          const ctx = musicCtxRef.current;
          musicCtxRef.current = null;
          musicGainRef.current = null;
          if (ctx) void ctx.close().catch(() => undefined);
        }
      }

      const playing = audioEl.play();
      await new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = (err?: Error) => {
          if (done) return;
          done = true;
          audioEl.removeEventListener('playing', onPlaying);
          audioEl.removeEventListener('error', onError);
          if (err) reject(err);
          else resolve();
        };
        const onPlaying = () => finish();
        const onError = () => finish(new Error('Waiting music file is not installed.'));
        audioEl.addEventListener('playing', onPlaying, { once: true });
        audioEl.addEventListener('error', onError, { once: true });
        playing.then(() => finish()).catch((err: unknown) => {
          const name = String((err as { name?: string })?.name || '');
          finish(
            name === 'NotSupportedError'
              ? new Error('Waiting music file is not installed.')
              : err instanceof Error
                ? err
                : new Error('Could not start waiting music.')
          );
        });
      });

      if (!mediaTrack) {
        type Capturable = HTMLMediaElement & {
          captureStream?: () => MediaStream;
          mozCaptureStream?: () => MediaStream;
        };
        const el = audioEl as Capturable;
        const capture = el.captureStream?.() || el.mozCaptureStream?.() || null;
        mediaTrack = capture?.getAudioTracks()[0] || null;
      }
      if (!mediaTrack) {
        audioEl.pause();
        throw new Error('captureStream not supported');
      }
      if (roomRef.current !== room) throw new Error('Could not start waiting music.');
      const localTrack = new LocalAudioTrack(mediaTrack, undefined, true);
      await room.localParticipant.publishTrack(localTrack, {
        name: HUDDLE_MUSIC_TRACK_NAME,
        source: Track.Source.Unknown,
      });
      musicTrackRef.current = localTrack;
      setMusicPlaying(true);
      setMusicActive(true);
    } catch (e) {
      await stopHuddleMusic();
      setMusicError(formatHuddleMusicError(e));
    } finally {
      setMusicBusy(false);
    }
  }, [musicPlaying, musicVolume, stopHuddleMusic]);

  const setHuddleMusicVolume = useCallback((next: number) => {
    const level = clampHuddleMusicVolume(next);
    setMusicVolume(level);
    const gain = musicGainRef.current;
    if (gain) {
      gain.gain.value = level;
      return;
    }
    const audioEl = musicAudioRef.current;
    if (audioEl) audioEl.volume = level;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void disconnectRoom();
    };
  }, [disconnectRoom]);

  const enableSound = useCallback(async () => {
    let unlocked = true;
    for (const el of audioElsRef.current.values()) {
      try {
        await el.play();
      } catch {
        unlocked = false;
      }
    }
    if (unlocked) setNeedSoundTap(false);
  }, []);

  const join = useCallback(async (opts?: { reconnect?: boolean }) => {
    if (joinInFlightRef.current || roomRef.current) return;
    joinInFlightRef.current = true;
    leaveIntentionalRef.current = false;
    const reconnecting = Boolean(opts?.reconnect);
    setConn(reconnecting ? 'reconnecting' : 'connecting');
    setError(null);
    setRoomFull(null);
    if (!reconnecting) {
      setRoster([]);
      setChatMessages([]);
      setChatUnread(0);
      setActiveTab(null);
    }
    setNotice(null);
    try {
      // 1. Same shared line as everyone else in this huddle (Vault or Connect).
      const plan = await planHuddleLine(channelId);
      if (!mountedRef.current) return;
      if (plan.provider === 'daily') {
        setDailyCreds(plan.creds);
        return;
      }
      if (plan.provider === 'blocked') {
        setError(plan.error);
        setConn('error');
        return;
      }

      // 2. Token with two retries, then the saved permission if the database is down.
      const tokenPayload = await fetchHuddleTokenResilient(channelId, {
        onRetry: () => {
          if (mountedRef.current) setNotice('The church server is slow. Trying again…');
        },
      });
      if (!mountedRef.current) return;
      setNotice(
        tokenPayload.fallback
          ? 'The church database is having trouble, so you joined with the permission saved from your last Ka Link. Everything in the call works as usual.'
          : null
      );
      setTitle(tokenPayload.channelName || channelName || 'Live Ka Link');
      setCanModerate(Boolean(tokenPayload.canModerate));

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const onChange = () => refreshTiles(room);

      room
        .on(RoomEvent.ParticipantConnected, () => {
          if (captionsOnRef.current) {
            void room.localParticipant
              .publishData(encodeCaptionWire({ v: 1, t: 'on' }), { reliable: true, topic: HUDDLE_CAPTION_TOPIC })
              .catch(() => undefined);
          }
          onChange();
        })
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          const prefix = `${p.identity}:`;
          for (const key of Array.from(audioElsRef.current.keys()) as string[]) {
            if (key === p.identity || key.startsWith(prefix)) detachRemoteAudio(key);
          }
          setCaptionLines((prev) => {
            if (!prev[p.identity]) return prev;
            const next = { ...prev };
            delete next[p.identity];
            return next;
          });
          onChange();
        })
        .on(RoomEvent.ParticipantMetadataChanged, onChange)
        .on(RoomEvent.ActiveSpeakersChanged, onChange)
        .on(RoomEvent.TrackMuted, (pub: TrackPublication, participant) => {
          if (participant?.isLocal && pub.source === Track.Source.Microphone) {
            setMicEnabled(false);
            micEnabledRef.current = false;
            if (!selfMuteIntentRef.current && micEnabledRef.current) {
              setHostMuteNotice(HUDDLE_HOST_MUTE_NOTICE);
            }
          }
          onChange();
        })
        .on(RoomEvent.TrackUnmuted, (pub: TrackPublication, participant) => {
          if (participant?.isLocal && pub.source === Track.Source.Microphone) {
            setMicEnabled(true);
            micEnabledRef.current = true;
            setHostMuteNotice(null);
          }
          onChange();
        })
        .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
          if (!participant?.isLocal) return;
          if (!huddleMicrophonePublishAllowed(participant.permissions)) {
            void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
            setMicEnabled(false);
            micEnabledRef.current = false;
            setHostMuteNotice(HUDDLE_HOST_MUTE_NOTICE);
          }
          onChange();
        })
        .on(RoomEvent.LocalTrackPublished, onChange)
        .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
          if (pub.source === Track.Source.Microphone) {
            setMicEnabled(false);
            micEnabledRef.current = false;
          }
          if (isHuddleMusicPublication(pub)) {
            setMusicPlaying(false);
            musicTrackRef.current = null;
          }
          onChange();
        })
        .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
          if (!mountedRef.current || !participant) return;
          if (topic === HUDDLE_CAPTION_TOPIC) {
            const wire = decodeCaptionWire(payload);
            if (!wire) return;
            if (wire.t === 'on') {
              setRoomWantsCaptions(true);
              return;
            }
            setCaptionLines((prev) =>
              upsertCaption(prev, {
                identity: participant.identity,
                name: displayName(participant),
                isLocal: false,
                id: wire.id,
                text: wire.text,
                final: wire.final,
                at: Date.now(),
              })
            );
            return;
          }
          // Emoji reactions share the data channel with chat; handle them first.
          if (!topic || topic === HUDDLE_REACTION_TOPIC) {
            try {
              const wire = parseHuddleReactionWirePayload(
                JSON.parse(new TextDecoder().decode(payload))
              );
              if (wire) {
                if (participant.identity !== room.localParticipant.identity) {
                  const event = hydrateHuddleReactionEvent({
                    payload: wire,
                    senderIdentity: participant.identity,
                    senderName: displayName(participant),
                    localIdentity: room.localParticipant.identity,
                    ttlMs: HUDDLE_REACTION_TTL_MS,
                  });
                  if (event) ingestReactionRef.current(event);
                }
                return;
              }
            } catch {
              /* not a reaction — fall through to chat */
            }
          }
          const msg = decodeIncomingHuddleChat({
            bytes: payload,
            senderIdentity: participant.identity,
            senderName: displayName(participant),
            localIdentity: room.localParticipant.identity,
            localCanModerate: canModerateRef.current,
            topic: topic ?? null,
          });
          if (!msg) return;
          setChatMessages((prev) => appendHuddleChatMessage(prev, msg));
          if (activeTabRef.current !== 'chat' && !msg.isLocal) {
            setChatUnread((n) => n + 1);
          }
        })
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub, participant) => {
          if (track.kind === Track.Kind.Audio) {
            attachRemoteAudio(huddleRemoteAudioKey(participant.identity, pub?.trackSid), track);
          }
          onChange();
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub, participant) => {
          if (track.kind === Track.Kind.Audio) {
            try {
              track.detach();
            } catch {
              /* ignore */
            }
            detachRemoteAudio(huddleRemoteAudioKey(participant.identity, pub?.trackSid));
          }
          onChange();
        })
        .on(RoomEvent.TrackPublished, onChange)
        .on(RoomEvent.TrackUnpublished, onChange)
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (!mountedRef.current) return;
          if (connectingRef.current) return;
          clearRemoteAudio();
          roomRef.current = null;
          setTiles([]);
          if (leaveIntentionalRef.current) {
            setRoster([]);
            setChatMessages([]);
            setChatUnread(0);
            setActiveTab(null);
            setConn('prejoin');
            return;
          }
          if (huddleDisconnectIsFinal(reason)) {
            lostConnectionRef.current = true;
            setError(huddleDisconnectMessage(reason));
            setConn('error');
            return;
          }
          if (reconnectAttemptsRef.current >= MAX_HUDDLE_RECONNECTS) {
            lostConnectionRef.current = true;
              setError('Connection lost. Tap to rejoin the Ka Link.');
            setConn('error');
            return;
          }
          reconnectAttemptsRef.current += 1;
          setConn('reconnecting');
          window.setTimeout(() => {
            if (!mountedRef.current || leaveIntentionalRef.current) return;
            void joinRef.current();
          }, 600);
        });

      connectingRef.current = true;
      try {
        // 3. One connect; a LiveKit 429 (out of minutes) throws LiveKitQuotaError.
        await connectLiveKitOnce(room, tokenPayload.url, tokenPayload.token);
      } finally {
        connectingRef.current = false;
      }
      if (!mountedRef.current) {
        await room.disconnect(true);
        return;
      }

      // Join muted. The member turns their own mic on when they are ready.
      selfMuteIntentRef.current = true;
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } finally {
        selfMuteIntentRef.current = false;
      }
      setMicEnabled(false);
      micEnabledRef.current = false;
      if (camEnabled) {
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          setError('Camera could not be enabled. You can still join with audio.');
        }
      }

      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.kind === Track.Kind.Audio && pub.track) {
            attachRemoteAudio(huddleRemoteAudioKey(p.identity, pub.trackSid), pub.track as RemoteTrack);
          }
        }
      }

      refreshTiles(room);
      reconnectAttemptsRef.current = 0;
      lostConnectionRef.current = false;
      setConn('connected');

      // 4. Record LiveKit as this channel's line. If someone already moved the
      //    huddle to the backup line, follow them there.
      void claimHuddleLine(channelId, 'livekit').then(async (claimed) => {
        if (claimed.ok === true || claimed.provider !== 'daily' || !mountedRef.current) return;
        leaveIntentionalRef.current = true;
        await disconnectRoom();
        try {
          const creds = await fetchDailyCredentials(channelId);
          if (mountedRef.current) setDailyCreds(creds);
        } catch (err) {
          if (!mountedRef.current) return;
          setError(err instanceof Error && err.message ? err.message : 'Backup Ka Link audio is unavailable right now.');
          setConn('error');
        }
      });
      setHandRaised(parseHandRaised(room.localParticipant.metadata));
    } catch (err) {
      await disconnectRoom();
      if (!mountedRef.current) return;
      if (err instanceof LiveKitQuotaError) {
        // LiveKit is out of minutes: move this huddle to the backup line.
        rememberLiveKitQuota();
        try {
          const creds = await fetchDailyCredentials(channelId);
          if (mountedRef.current) setDailyCreds(creds);
          return;
        } catch (dailyErr) {
          setError(
            dailyErr instanceof Error && dailyErr.message
              ? dailyErr.message
              : 'Backup Ka Link audio is unavailable right now.'
          );
          setConn('error');
          return;
        }
      }
      setNotice(null);
      if ((err instanceof CommunityChatError && err.code === 'huddle_room_full') || isRoomFullError(err)) {
        setError('This prayer room is full.');
        setRoomFull({ checking: true, overflow: null });
        setConn('error');
        void findSanctumOverflow(channelId).then((overflow) => {
          if (mountedRef.current) setRoomFull({ checking: false, overflow });
        });
        return;
      }
      const message =
        err instanceof CommunityChatError
          ? err.message
          : 'Could not join the Ka Link. Please try again.';
      setError(message);
      setConn('error');
    } finally {
      joinInFlightRef.current = false;
    }
  }, [
    attachRemoteAudio,
    camEnabled,
    channelId,
    channelName,
    clearRemoteAudio,
    detachRemoteAudio,
    disconnectRoom,
    refreshTiles,
  ]);

  useEffect(() => {
    joinRef.current = () => join({ reconnect: true });
  }, [join]);

  // Phones drop the call when the screen sleeps or the member switches tabs.
  // When they come back, rejoin on their own instead of leaving them kicked out.
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState !== 'visible') return;
      if (!mountedRef.current || leaveIntentionalRef.current || !lostConnectionRef.current) return;
      lostConnectionRef.current = false;
      reconnectAttemptsRef.current = 0;
      setError(null);
      setConn('reconnecting');
      void joinRef.current();
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('pageshow', onBack);
    window.addEventListener('online', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('pageshow', onBack);
      window.removeEventListener('online', onBack);
    };
  }, []);

  const leave = useCallback(async () => {
    leaveIntentionalRef.current = true;
    reconnectAttemptsRef.current = MAX_HUDDLE_RECONNECTS;
    await disconnectRoom();
    setConn('prejoin');
    setTiles([]);
    setRoster([]);
    setChatMessages([]);
    setChatUnread(0);
    setActiveTab(null);
    setHandRaised(false);
    setCanModerate(false);
    onClose();
  }, [disconnectRoom, onClose]);

  const endForEveryone = useCallback(async () => {
    if (!canModerate || ending) return;
    const ok = window.confirm(
      'End this Live Ka Link for everyone? All participants will be disconnected.'
    );
    if (!ok) return;
    setEnding(true);
    setError(null);
    leaveIntentionalRef.current = true;
    reconnectAttemptsRef.current = MAX_HUDDLE_RECONNECTS;
    try {
      await endHuddle(channelId);
      await disconnectRoom();
      setConn('prejoin');
      setTiles([]);
      setRoster([]);
      setChatMessages([]);
      setChatUnread(0);
      setActiveTab(null);
      setHandRaised(false);
      setCanModerate(false);
      onClose();
    } catch (err) {
      const message =
        err instanceof CommunityChatError
          ? err.message
          : 'Could not end the Ka Link. Please try again.';
      setError(message);
    } finally {
      setEnding(false);
    }
  }, [canModerate, channelId, disconnectRoom, ending, onClose]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {
      setMicEnabled((v) => !v);
      return;
    }
    const next = !micEnabled;
    if (next && !huddleMicrophonePublishAllowed(room.localParticipant.permissions)) {
      setMicEnabled(false);
      micEnabledRef.current = false;
      setHostMuteNotice(HUDDLE_HOST_MUTE_NOTICE);
      return;
    }
    selfMuteIntentRef.current = true;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      micEnabledRef.current = next;
      if (next) setHostMuteNotice(null);
      refreshTiles(room);
    } catch {
      if (next) {
        setMicEnabled(false);
        micEnabledRef.current = false;
        setHostMuteNotice(HUDDLE_HOST_MUTE_NOTICE);
      } else {
        setError('Could not change microphone.');
      }
    } finally {
      selfMuteIntentRef.current = false;
    }
  }, [micEnabled, refreshTiles]);

  useEffect(() => {
    captionsOnRef.current = captionsOn;
    writePref(CAPTIONS_PREF_KEY, captionsOn ? '1' : '0');
    const room = roomRef.current;
    if (captionsOn && room && conn === 'connected') {
      void room.localParticipant
        .publishData(encodeCaptionWire({ v: 1, t: 'on' }), { reliable: true, topic: HUDDLE_CAPTION_TOPIC })
        .catch(() => undefined);
    }
  }, [captionsOn, conn]);

  useEffect(() => {
    writePref(CAPTION_LANG_KEY, captionLang);
  }, [captionLang]);

  // Caption my own speech while my mic is on and anyone (me included) wants captions.
  const shouldTranscribe =
    conn === 'connected' && micEnabled && !prayerWatch && (captionsOn || roomWantsCaptions) && speechCaptionsSupported();
  useEffect(() => {
    if (!shouldTranscribe) return undefined;
    let lastSent = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const send = (line: { id: string; text: string; final: boolean }) => {
      const room = roomRef.current;
      if (!room) return;
      void room.localParticipant
        .publishData(encodeCaptionWire({ v: 1, t: 'line', ...line, lang: captionLang }), {
          reliable: line.final,
          topic: HUDDLE_CAPTION_TOPIC,
        })
        .catch(() => undefined);
      setCaptionLines((prev) =>
        upsertCaption(prev, {
          identity: room.localParticipant.identity,
          name: 'You',
          isLocal: true,
          ...line,
          at: Date.now(),
        })
      );
    };
    const recognizer = new CaptionRecognizer(
      (line) => {
        // Words in progress go out a few times a second; finished lines go at once.
        if (pending) clearTimeout(pending);
        const wait = line.final ? 0 : Math.max(0, 350 - (Date.now() - lastSent));
        pending = setTimeout(() => {
          lastSent = Date.now();
          send(line);
        }, wait);
      },
      (error) => {
        if (error === 'language-not-supported') {
          setCaptionNotice(
            captionLang === 'lg'
              ? 'Luganda captions are not available in this browser yet. Pick English or Kiswahili for your speech.'
              : 'This language is not available for captions in this browser.'
          );
        } else if (error === 'not-allowed') {
          setCaptionNotice('Allow the microphone for this site so your speech can be captioned.');
        } else if (error === 'network') {
          setCaptionNotice('Captions need an internet connection to the speech service. Retrying…');
        }
      }
    );
    setCaptionNotice(null);
    recognizer.start(captionLang);
    return () => {
      if (pending) clearTimeout(pending);
      recognizer.stop();
    };
  }, [shouldTranscribe, captionLang]);

  // Tick so finished lines fade out.
  useEffect(() => {
    if (!captionsOn) return undefined;
    const timer = window.setInterval(() => setCaptionClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [captionsOn]);

  const shownCaptions = useMemo(
    () => (captionsOn ? visibleCaptions(captionLines, captionClock) : []),
    [captionsOn, captionLines, captionClock]
  );

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !canModerateRef.current) return;
    setScreenError(null);
    if (!screenShareSupported()) {
      setScreenError('Phones can’t share their screen from a browser. Join this Ka Link on a computer (Chrome, Edge, Firefox or Safari) to share.');
      return;
    }
    const sharingNow = room.localParticipant.isScreenShareEnabled;
    if (!sharingNow && sharer && !sharer.isLocal) {
      setScreenError(`${sharer.name} is already sharing. Only one screen at a time.`);
      return;
    }
    setScreenBusy(true);
    try {
      await room.localParticipant.setScreenShareEnabled(
        !sharingNow,
        !sharingNow
          ? {
              audio: true,
              selfBrowserSurface: 'exclude',
              surfaceSwitching: 'include',
              systemAudio: 'include',
              resolution: { width: 1920, height: 1080, frameRate: 15 },
            }
          : undefined
      );
    } catch (e) {
      const name = (e as { name?: string })?.name;
      // Closing the browser's picker is not an error.
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        const msg = String((e as Error)?.message || '');
        setScreenError(
          /permission|insufficient|not allowed/i.test(msg)
            ? 'Only moderators and up can share their screen in a Ka Link.'
            : 'Could not share your screen. Please try again.'
        );
      }
    } finally {
      setScreenBusy(false);
      refreshTiles(room);
    }
  }, [refreshTiles, sharer]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {
      setCamEnabled((v) => !v);
      return;
    }
    const next = !camEnabled;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamEnabled(next);
      refreshTiles(room);
    } catch {
      setError('Camera permission is required to turn video on.');
    }
  }, [camEnabled, refreshTiles]);

  /** Listen only: turn my mic (and camera) off and keep them off until I switch it back. */
  const toggleListenOnly = useCallback(async () => {
    if (listenOnly) {
      setListenOnly(false);
      return;
    }
    if (micEnabled) await toggleMic();
    if (camEnabled) await toggleCam();
    setListenOnly(true);
  }, [listenOnly, micEnabled, camEnabled, toggleMic, toggleCam]);

  // While the room is full and no overflow is open yet, look again every 15 seconds.
  useEffect(() => {
    if (!roomFull || roomFull.checking || roomFull.overflow?.available) return;
    const timer = window.setInterval(() => {
      void findSanctumOverflow(channelId).then((overflow) => {
        if (mountedRef.current && overflow.available) setRoomFull({ checking: false, overflow });
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [roomFull, channelId]);

  const toggleHand = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const local: LocalParticipant = room.localParticipant;
    const next = !handRaised;
    try {
      await local.setMetadata(mergeHandMetadata(local.metadata, next));
      setHandRaised(next);
      refreshTiles(room);
    } catch {
      setError('Could not update hand raise.');
    }
  }, [handRaised, refreshTiles]);

  const clearReactionTimers = useCallback(() => {
    reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
    reactionTimersRef.current.clear();
  }, []);

  const ingestReaction = useCallback((rxn: HuddleReactionEvent) => {
    setActiveReactions((prev) => appendHuddleReactionEvent(prev, rxn));
    const existing = reactionTimersRef.current.get(rxn.id);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, rxn.expiresAt - Date.now());
    const timer = setTimeout(() => {
      reactionTimersRef.current.delete(rxn.id);
      setActiveReactions((prev) => expireHuddleReactions(prev, Date.now()));
    }, delay || HUDDLE_REACTION_TTL_MS);
    reactionTimersRef.current.set(rxn.id, timer);
  }, []);

  useEffect(() => {
    ingestReactionRef.current = ingestReaction;
  }, [ingestReaction]);

  // Clear floating reactions whenever the call is not live, and on unmount.
  useEffect(() => {
    if (conn === 'connected' || conn === 'reconnecting') return;
    clearReactionTimers();
    setActiveReactions(clearHuddleReactions());
    setReactionPickerOpen(false);
    setReactionBusy(false);
    setReactionError(null);
    setLastReactionSentAt(null);
  }, [conn, clearReactionTimers]);
  useEffect(() => clearReactionTimers, [clearReactionTimers]);

  const sendHuddleReaction = useCallback(
    async (key: HuddleReactionKey) => {
      const room = roomRef.current;
      if (!room || conn !== 'connected' || reactionBusy) return;
      if (
        !shouldAllowHuddleReactionSend({
          lastSentAt: lastReactionSentAt,
          cooldownMs: HUDDLE_REACTION_COOLDOWN_MS,
        })
      ) {
        return;
      }
      const payload = buildHuddleReactionWirePayload({
        reaction: key,
        id: createHuddleReactionId(),
        sentAt: Date.now(),
      });
      if (!payload) {
        setReactionError('Could not send reaction.');
        return;
      }
      setReactionBusy(true);
      setReactionError(null);
      try {
        const local = room.localParticipant;
        await local.publishData(encodeHuddleReactionPayload(payload), {
          reliable: true,
          topic: HUDDLE_REACTION_TOPIC,
        });
        const localRxn = hydrateHuddleReactionEvent({
          payload,
          senderIdentity: local.identity,
          senderName: 'You',
          localIdentity: local.identity,
          ttlMs: HUDDLE_REACTION_TTL_MS,
        });
        if (localRxn) ingestReaction(localRxn);
        setLastReactionSentAt(Date.now());
        setReactionPickerOpen(false);
      } catch {
        setReactionError("Couldn't send reaction. You're still in the Ka Link.");
      } finally {
        setReactionBusy(false);
      }
    },
    [conn, ingestReaction, lastReactionSentAt, reactionBusy]
  );

  const sendChat = useCallback(async (text: string) => {
    const room = roomRef.current;
    if (!room) return;
    const local = room.localParticipant;
    const wire = buildHuddleChatWirePayload({
      id: createHuddleChatId(),
      text,
    });
    if (!wire) return;
    setChatSending(true);
    try {
      await local.publishData(encodeHuddleChatPayload(wire), {
        reliable: true,
        topic: HUDDLE_CHAT_TOPIC,
      });
      const localMsg = hydrateHuddleChatMessage({
        payload: wire,
        senderIdentity: local.identity,
        senderName: displayName(local),
        localIdentity: local.identity,
        localCanModerate: canModerateRef.current,
      });
      if (localMsg) {
        setChatMessages((prev) => appendHuddleChatMessage(prev, localMsg));
      }
    } catch {
      setError('Could not send Ka Link chat message.');
    } finally {
      setChatSending(false);
    }
  }, []);

  const participantFor = (identity: string): Participant | null => {
    const room = roomRef.current;
    if (!room) return null;
    if (room.localParticipant.identity === identity) return room.localParticipant;
    return room.remoteParticipants.get(identity) || null;
  };

  const raisedNames = useMemo(
    () => tiles.filter((t) => t.handRaised).map((t) => (t.isLocal ? `${t.name} (you)` : t.name)),
    [tiles]
  );
  const raisedEntries = useMemo(
    () =>
      tiles
        .filter((t) => t.handRaised)
        .map((t) => ({ identity: t.identity, name: t.name, isLocal: t.isLocal })),
    [tiles]
  );
  const inCount = roster.filter((e) => e.status === 'in').length;

  if (dailyCreds) {
    return (
      <Suspense
        fallback={
          <div className={`${shellClass} flex items-center justify-center bg-[#0f0a0c] text-white`} role="status">
            <Loader2 className="animate-spin mr-2" size={18} aria-hidden /> Switching to the backup line…
          </div>
        }
      >
        <DailyBackupHuddle creds={dailyCreds} title={title} onClose={onClose} embedded={embedded} />
      </Suspense>
    );
  }

  // Full-screen huddle: the approved PLCC prayer-room design (shared with PLCC Sanctum's
  // overflow room via prayer-room.css). The embedded Prayer Watch panel keeps the compact
  // dark layout below.
  if (!embedded) {
    const localTile = tiles.find((t) => t.isLocal);
    const speakingNow = tiles.filter((t) => t.speaking && t.micOn).map((t) => (t.isLocal ? 'You' : t.name));
    const anyVideo = tiles.some((t) => t.camOn);
    const connected = conn === 'connected';
    const orbState: 'speaking' | 'open' | 'muted' =
      connected && micEnabled && localTile?.speaking ? 'speaking' : micEnabled ? 'open' : 'muted';
    const peopleCount = inCount || tiles.length;
    const query = peopleQuery.trim().toLowerCase();
    const peopleList = [...tiles]
      .sort(
        (a, b) =>
          Number(b.moderator) - Number(a.moderator) ||
          Number(b.handRaised) - Number(a.handRaised) ||
          Number(b.speaking) - Number(a.speaking) ||
          a.name.localeCompare(b.name)
      )
      .filter((t) => !query || t.name.toLowerCase().includes(query));
    const initials = (name: string) =>
      name
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'M';
    const openNewTab = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
    const nav: Array<{ key: string; label: string; Icon: React.ElementType; onClick: () => void; active?: boolean }> = [
      { key: 'room', label: 'Prayer Room', Icon: Radio, active: true, onClick: () => undefined },
      { key: 'rooms', label: 'All Rooms', Icon: LayoutGrid, onClick: () => openNewTab('/live') },
      { key: 'request', label: 'Prayer Request', Icon: HandHeart, onClick: () => setSheet('prayer') },
      { key: 'wall', label: 'Prayer Wall', Icon: BookHeart, onClick: () => openNewTab(`${VAULT_URL.replace(/\/+$/, '')}/#/community/prayer-wall`) },
      { key: 'guide', label: 'Guidelines', Icon: CircleHelp, onClick: () => setSheet('guidelines') },
    ];
    const statusText = connected
      ? listenOnly
        ? 'Listening only'
        : orbState === 'speaking'
          ? 'You are speaking'
          : micEnabled
            ? 'Your microphone is on'
            : 'You are Muted'
      : micEnabled
        ? 'You will join unmuted'
        : 'You will join muted';

    return (
      <div className={`${shellClass} pr-shell overflow-hidden`} role="dialog" aria-modal aria-label="Live Ka Link">
        {connected && activeReactions.length > 0 ? (
          <div
            className="pointer-events-none absolute right-3 bottom-24 z-40 flex max-w-[min(14rem,46%)] flex-col-reverse items-end gap-1.5"
            data-huddle-reactions-overlay="true"
            aria-hidden="true"
          >
            {activeReactions.map((rxn) => (
              <div
                key={rxn.id}
                className="flex items-center gap-1.5 rounded-2xl border border-gold/50 bg-[#0f3d2c] px-2.5 py-1.5 text-gold shadow-lg animate-in fade-in zoom-in-95 duration-200"
              >
                <span className="text-lg leading-none">{rxn.emoji}</span>
                <span className="max-w-[7rem] truncate text-[11px] font-bold">{rxn.isLocal ? 'You' : rxn.senderName}</span>
              </div>
            ))}
          </div>
        ) : null}

        <header className="pr-header">
          <div className="pr-header-inner">
            <div className="pr-brand">
              <img src="/prayer-room/prayer-emblem.png" alt="" aria-hidden className="pr-emblem" />
              <div className="min-w-0">
                <p className="pr-brand-name">PLCC JORDAN</p>
                <p className="pr-brand-sub">Main Prayer Room</p>
              </div>
            </div>
            <div className="pr-church">
              <p className="pr-church-name">Promised Land Christian Center</p>
              <p className="pr-church-tag">One family. Many nations. One purpose.</p>
            </div>
            <div className="pr-header-actions">
              {connected && !prayerWatch ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('attendance')}
                  className="pr-icon-btn"
                  aria-label={`Attendance, ${inCount} in Ka Link`}
                >
                  <Users size={22} aria-hidden />
                  <span className="tabular-nums">{peopleCount}</span>
                </button>
              ) : null}
              <button type="button" onClick={() => setSheet('guidelines')} className="pr-icon-btn pr-desktop-only" aria-label="Guidelines">
                <CircleHelp size={24} aria-hidden />
              </button>
              <button type="button" onClick={() => void leave()} className="pr-icon-btn is-solid" aria-label="Close Ka Link">
                <X size={22} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        <nav className="pr-chips" aria-label="Prayer room">
          {nav.map(({ key, label, Icon, onClick, active }) => (
            <button key={key} type="button" onClick={onClick} className={`pr-chip ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </nav>

        <div className="pr-body">
          <aside className="pr-sidebar" aria-label="Prayer room">
            <nav className="pr-nav">
              {nav.map(({ key, label, Icon, onClick, active }) => (
                <button key={key} type="button" onClick={onClick} className={`pr-nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                  <Icon size={22} aria-hidden />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="pr-content">
            <div className="pr-panel">
              <main className="pr-room">
                <div className="pr-titlebar">
                  <div className="flex min-w-0 items-center gap-3 lg:gap-4">
                    <span className="pr-room-icon"><Headphones className="h-6 w-6 lg:h-9 lg:w-9" aria-hidden /></span>
                    <div className="min-w-0">
                      <p className="pr-room-title line-clamp-2">{title}</p>
                      <p className="pr-room-sub">
                        {prayerWatch ? 'Prayer call • Voice only' : 'Audio Prayer Room • Main Room'}
                        <Info size={16} aria-hidden className="opacity-70" />
                      </p>
                    </div>
                  </div>
                  <div className="pr-titlebar-meta flex shrink-0 flex-col items-end gap-2">
                    {connected ? (
                      <span className="pr-live"><i aria-hidden /> LIVE</span>
                    ) : null}
                    {connected ? (
                      <span className="pr-count">
                        <Users className="h-4 w-4 lg:h-6 lg:w-6" aria-hidden /> {peopleCount} {peopleCount === 1 ? 'Participant' : 'Participants'}
                      </span>
                    ) : null}
                  </div>
                </div>

                {needSoundTap ? (
                  <button
                    type="button"
                    onClick={() => void enableSound()}
                    className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#d9b45e] text-sm font-bold text-[#1d2414]"
                  >
                    <Volume2 size={18} aria-hidden />
                    Enable sound
                  </button>
                ) : null}
                {hostMuteNotice ? <p className="pr-notice is-strong" role="status">{hostMuteNotice}</p> : null}
                {screenError ? <p className="pr-notice is-bad" role="alert">{screenError}</p> : null}
                {notice ? <p className="pr-notice" role="status">{notice}</p> : null}
                {connected && raisedNames.length > 0 && !prayerWatch ? (
                  <div className="pr-hands-strip" data-testid="hands-raised-strip">
                    <p><Hand size={14} aria-hidden /> Hands raised</p>
                    <p>{raisedNames.join(', ')}</p>
                  </div>
                ) : null}
                {connected && sharer && participantFor(sharer.identity) ? (
                  <ScreenShareStage participant={participantFor(sharer.identity)!} sharer={sharer} />
                ) : null}

                {conn === 'connecting' || conn === 'reconnecting' ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-20 text-[#3a4640]">
                    <Loader2 className="animate-spin" size={30} aria-hidden />
                    <p className="text-base font-semibold">
                      {conn === 'reconnecting' ? 'Reconnecting…' : mode === 'start' ? 'Starting Ka Link…' : 'Joining Ka Link…'}
                    </p>
                  </div>
                ) : roomFull ? (
                  <div className="pr-full" role="status" aria-live="polite">
                    <span className="pr-full-icon"><Users className="h-8 w-8" aria-hidden /></span>
                    <p className="pr-full-title">This prayer room is full</p>
                    <p className="pr-full-text">
                      All 50 seats in <strong>{title}</strong> are taken right now.
                    </p>
                    {roomFull.checking ? (
                      <p className="pr-full-text inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Looking for the overflow room…
                      </p>
                    ) : roomFull.overflow?.available && roomFull.overflow.joinUrl ? (
                      <>
                        <button type="button" onClick={() => openSanctumOverflow(roomFull.overflow!.joinUrl!)} className="pr-full-go">
                          <Headphones className="h-6 w-6" aria-hidden />
                          Join the overflow room
                        </button>
                        <p className="pr-full-text">
                          <strong>{roomFull.overflow.roomName}</strong> in PLCC Sanctum
                          {roomFull.overflow.hearsJordan
                            ? ' — you will hear the same live prayer.'
                            : ' — led by its own prayer leaders.'}
                        </p>
                      </>
                    ) : (
                      <p className="pr-full-text">
                        The overflow room isn&apos;t open yet. We&apos;ll show it here as soon as a moderator opens it — or try again in a moment.
                      </p>
                    )}
                    <div className="flex flex-wrap justify-center gap-2.5">
                      <button type="button" onClick={() => void join()} className="pr-tool">
                        <RefreshCw size={16} aria-hidden /> Try this room again
                      </button>
                      <button type="button" onClick={() => void leave()} className="pr-tool">
                        Not now
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="pr-stage">
                      <div className="pr-orb-row">
                        <span className={`pr-wave is-left ${speakingNow.length ? 'is-active' : ''}`} aria-hidden>
                          {Array.from({ length: 9 }).map((_, n) => <i key={n} style={{ animationDelay: `${n * 0.11}s` }} />)}
                        </span>
                        <button
                          type="button"
                          onClick={() => (listenOnly ? undefined : void toggleMic())}
                          className={`pr-orb ${orbState === 'open' ? 'is-open' : ''} ${orbState === 'speaking' ? 'is-open is-speaking' : ''} ${listenOnly ? 'is-locked' : ''}`}
                          aria-label={listenOnly ? 'Listening only' : micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                          aria-pressed={micEnabled}
                        >
                          {micEnabled ? <Mic aria-hidden /> : <MicOff aria-hidden />}
                        </button>
                        <span className={`pr-wave ${speakingNow.length ? 'is-active' : ''}`} aria-hidden>
                          {Array.from({ length: 9 }).map((_, n) => <i key={n} style={{ animationDelay: `${n * 0.11}s` }} />)}
                        </span>
                      </div>
                      <p className={`pr-status ${micEnabled && !listenOnly ? 'is-open' : ''}`}>
                        {micEnabled && !listenOnly ? <Mic size={20} aria-hidden /> : listenOnly ? <Volume2 size={20} aria-hidden /> : <MicOff size={20} aria-hidden />}
                        {statusText}
                      </p>
                      <p className="pr-hint">
                        {connected
                          ? speakingNow.length
                            ? <>Now praying: <strong>{speakingNow.slice(0, 3).join(', ')}</strong></>
                            : audioOnly || prayerWatch
                              ? 'Audio Only • Raise your hand to pray aloud'
                              : 'Audio first • Raise your hand to pray aloud'
                          : mode === 'start'
                            ? 'Start a Live Ka Link for this room. Everyone in it can join from their phone or computer.'
                            : `Leaving does not end the prayer for others${canModerate ? ' unless you end it for everyone' : ''}.`}
                      </p>
                    </div>

                    {connected && anyVideo ? (
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {tiles
                          .filter((t) => t.camOn)
                          .map((tile) => {
                            const participant = participantFor(tile.identity);
                            return (
                              <li
                                key={tile.identity}
                                className={`relative aspect-video overflow-hidden rounded-2xl bg-[#062a1d] ring-2 ${tile.speaking ? 'ring-[#d9b45e]' : 'ring-transparent'}`}
                              >
                                {participant ? <ParticipantVideo participant={participant} isLocal={tile.isLocal} camOn={tile.camOn} /> : null}
                                <p className="absolute inset-x-0 bottom-0 z-10 truncate bg-gradient-to-t from-black/80 to-transparent p-2 text-xs font-bold text-white">
                                  {tile.name}
                                  {tile.isLocal ? ' (you)' : ''}
                                </p>
                              </li>
                            );
                          })}
                      </ul>
                    ) : null}

                    {conn === 'prejoin' || conn === 'error' ? (
                      <div className="mx-auto w-full max-w-md space-y-3 pb-2">
                        {error ? <p className="text-center text-sm font-semibold text-[#9c2a23]">{error}</p> : null}
                        {!audioOnly ? (
                          <button
                            type="button"
                            onClick={() => setCamEnabled((v) => !v)}
                            className="pr-tool w-full"
                            aria-pressed={camEnabled}
                          >
                            {camEnabled ? <Video size={18} aria-hidden /> : <VideoOff size={18} aria-hidden />}
                            {camEnabled ? 'Camera on when I join' : 'Camera off when I join'}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void join()} className="min-h-[56px] w-full rounded-2xl bg-[#0f3d2c] text-lg font-bold text-white shadow-lg">
                          {mode === 'start' ? 'Start Ka Link' : 'Join prayer room'}
                        </button>
                        <button type="button" onClick={() => void leave()} className="min-h-[44px] w-full text-sm font-semibold text-[#3a4640]">
                          Not now
                        </button>
                      </div>
                    ) : null}

                    {connected ? (
                      <>
                        <div className="pr-tiles">
                          {!prayerWatch ? (
                            <button type="button" onClick={() => void toggleHand()} aria-pressed={handRaised} className={`pr-tile ${handRaised ? 'is-on' : 'is-gold'}`}>
                              <span className="pr-tile-icon"><Hand className="h-6 w-6 lg:h-7 lg:w-7" aria-hidden /></span>
                              <span className="pr-tile-title">{handRaised ? 'Hand Raised' : 'Raise Hand'}</span>
                              <span className="pr-tile-sub">{handRaised ? 'Tap to lower' : 'Request to Speak'}</span>
                            </button>
                          ) : (
                            <button type="button" onClick={() => setActiveTab('chat')} className="pr-tile">
                              <span className="pr-tile-icon"><MessageCircle className="h-6 w-6" aria-hidden /></span>
                              <span className="pr-tile-title">Chat</span>
                              <span className="pr-tile-sub">Pray in writing</span>
                            </button>
                          )}
                          {listenOnly ? (
                            <div className="pr-tile is-off" aria-disabled>
                              <span className="pr-tile-icon"><Mic className="h-6 w-6 lg:h-7 lg:w-7" aria-hidden /></span>
                              <span className="pr-tile-title">Unmute</span>
                              <span className="pr-tile-sub">(Listen only is on)</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void toggleMic()}
                              aria-pressed={micEnabled}
                              className={`pr-tile ${micEnabled ? 'is-live' : 'is-off'}`}
                              style={{ cursor: 'pointer' }}
                            >
                              <span className="pr-tile-icon">{micEnabled ? <Mic className="h-6 w-6 lg:h-7 lg:w-7" aria-hidden /> : <MicOff className="h-6 w-6 lg:h-7 lg:w-7" aria-hidden />}</span>
                              <span className="pr-tile-title">{micEnabled ? 'Mute' : 'Unmute'}</span>
                              <span className="pr-tile-sub">{micEnabled ? 'Others hear you' : 'Pray aloud'}</span>
                            </button>
                          )}
                          <button type="button" onClick={() => void toggleListenOnly()} aria-pressed={listenOnly} className={`pr-tile ${listenOnly ? 'is-on' : ''}`}>
                            <span className="pr-tile-icon"><Volume2 className="h-6 w-6 lg:h-7 lg:w-7" aria-hidden /></span>
                            <span className="pr-tile-title">Listen Only</span>
                            <span className="pr-tile-sub">{listenOnly ? 'On — tap to turn off' : 'Keep my mic off'}</span>
                          </button>
                        </div>

                        <div className="pr-tools">
                          {!prayerWatch ? (
                            <button type="button" onClick={() => setSheet('prayer')} className="pr-tool">
                              <HandHeart size={18} aria-hidden /> Prayer Request
                            </button>
                          ) : null}
                          {!prayerWatch ? (
                            <button type="button" onClick={() => setActiveTab('chat')} className="pr-tool relative">
                              <MessageCircle size={18} aria-hidden /> Chat
                              {chatUnread > 0 ? <span className="ml-1 rounded-full bg-[#c4352d] px-1.5 text-[11px] font-black text-white">{chatUnread}</span> : null}
                            </button>
                          ) : null}
                          {!audioOnly ? (
                            <button
                              type="button"
                              onClick={() => void toggleCam()}
                              disabled={listenOnly}
                              className={`pr-tool is-icon ${camEnabled ? 'is-on' : ''}`}
                              aria-label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
                              title={camEnabled ? 'Camera off' : 'Camera on'}
                            >
                              {camEnabled ? <Video size={20} /> : <VideoOff size={20} />}
                            </button>
                          ) : null}
                          {!prayerWatch ? (
                            <button
                              type="button"
                              onClick={() => setCaptionsOn((v) => !v)}
                              className={`pr-tool is-icon ${captionsOn ? 'is-on' : ''}`}
                              aria-label={captionsOn ? 'Turn live captions off' : 'Turn live captions on'}
                              aria-pressed={captionsOn}
                              title="Live captions"
                              data-testid="huddle-captions-toggle"
                            >
                              {captionsOn ? <CaptionsOff size={20} aria-hidden /> : <Captions size={20} aria-hidden />}
                            </button>
                          ) : null}
                          {canModerate && !audioOnly && !prayerWatch && screenShareSupported() ? (
                            <button
                              type="button"
                              onClick={() => void toggleScreenShare()}
                              disabled={screenBusy || Boolean(sharer && !sharer.isLocal)}
                              title={sharer && !sharer.isLocal ? `${sharer.name} is sharing` : 'Share screen'}
                              className={`pr-tool is-icon ${sharer?.isLocal ? 'is-on' : ''}`}
                              aria-label={sharer?.isLocal ? 'Stop sharing your screen' : 'Share your screen'}
                              aria-pressed={Boolean(sharer?.isLocal)}
                              data-testid="huddle-screen-share-toggle"
                            >
                              {screenBusy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : sharer?.isLocal ? <MonitorOff size={20} aria-hidden /> : <Monitor size={20} aria-hidden />}
                            </button>
                          ) : null}
                          {!prayerWatch ? (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  setReactionError(null);
                                  setReactionPickerOpen((open) => !open);
                                }}
                                disabled={reactionBusy}
                                className={`pr-tool is-icon ${reactionPickerOpen ? 'is-on' : ''}`}
                                aria-label="Open Ka Link reactions"
                                aria-expanded={reactionPickerOpen}
                                aria-haspopup="menu"
                                title="Reactions"
                                data-huddle-reaction-control="true"
                              >
                                <Smile size={20} aria-hidden />
                              </button>
                              {reactionPickerOpen ? (
                                <div
                                  role="menu"
                                  aria-label="Ka Link reactions"
                                  className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-50 w-52 -translate-x-1/2 rounded-2xl border border-[#eadfca] bg-white p-2 shadow-xl"
                                >
                                  <p className="px-2 pb-1.5 text-xs font-black uppercase tracking-[0.2em] text-[#7a5a1c]">Reactions</p>
                                  <div className="grid grid-cols-1 gap-1">
                                    {HUDDLE_REACTION_OPTIONS.map((opt) => (
                                      <button
                                        key={opt.key}
                                        type="button"
                                        role="menuitem"
                                        disabled={reactionBusy}
                                        onClick={() => void sendHuddleReaction(opt.key)}
                                        className="flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 text-left text-[13px] font-bold text-[#16251f] hover:bg-[#f6f1e6] disabled:opacity-40"
                                        aria-label={opt.label}
                                      >
                                        <span className="text-lg leading-none" aria-hidden>{opt.emoji}</span>
                                        <span>{opt.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {canPlayHuddleMusic ? (
                            <button
                              type="button"
                              onClick={() => void toggleHuddleMusic()}
                              disabled={musicBusy || (musicActive && !musicPlaying)}
                              className={`pr-tool ${musicPlaying || musicActive ? 'is-on' : ''}`}
                              aria-label={musicActive && !musicPlaying ? 'Music is already playing' : huddleMusicButtonLabel(musicPlaying)}
                              aria-pressed={musicPlaying}
                              data-huddle-music-control="true"
                            >
                              {musicBusy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Music size={18} aria-hidden />}
                              <span>{huddleMusicButtonLabel(musicPlaying, musicActive)}</span>
                            </button>
                          ) : null}
                          {!prayerWatch ? (
                            <button type="button" onClick={() => void shareHuddle()} className="pr-tool">
                              <Share2 size={18} aria-hidden />
                              <span>{shareDone || 'Share'}</span>
                            </button>
                          ) : null}
                        </div>

                        {musicActive ? (
                          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#d9b45e]/25 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-[#7a5a1c]" role="status" data-huddle-music-active="true">
                              <Music size={12} aria-hidden />
                              Music playing
                            </span>
                            {musicPlaying && canPlayHuddleMusic ? (
                              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#3a4640]">
                                <span className="whitespace-nowrap">Music volume</span>
                                <input
                                  type="range"
                                  min={HUDDLE_MUSIC_MIN_VOLUME}
                                  max={HUDDLE_MUSIC_MAX_VOLUME}
                                  step={0.01}
                                  value={musicVolume}
                                  onChange={(e) => setHuddleMusicVolume(Number(e.target.value))}
                                  className="w-28 accent-[#C9A35A]"
                                  aria-label="Music volume"
                                  data-huddle-music-volume="true"
                                />
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                        {error ? <p className="text-center text-xs text-[#9c2a23]">{error}</p> : null}
                        {reactionError ? <p className="text-center text-xs text-[#7a5a1c]" role="status">{reactionError}</p> : null}
                        {musicError ? <p className="text-center text-xs text-[#7a5a1c]" role="status" data-huddle-music-error="true">{musicError}</p> : null}

                        {captionsOn && !prayerWatch ? (
                          <section aria-label="Live captions" className="w-full rounded-2xl bg-[#062a1d] px-3 py-2.5 text-white" data-testid="huddle-captions">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f1d58a]">Live captions</p>
                              <label className="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
                                I speak
                                <select
                                  value={captionLang}
                                  onChange={(e) => setCaptionLang(e.target.value as CaptionLanguage)}
                                  className="min-h-[32px] rounded-lg bg-white/10 px-2 text-xs font-bold text-white [&>option]:text-black"
                                >
                                  {CAPTION_LANGUAGES.map((l) => (
                                    <option key={l.code} value={l.code}>
                                      {l.label}
                                      {l.note ? ` (${l.note})` : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div aria-live="polite" className="min-h-[2.75rem] space-y-0.5">
                              {shownCaptions.length ? (
                                shownCaptions.map((line) => (
                                  <p key={line.identity} className="text-sm leading-snug sm:text-base">
                                    <span className="font-bold text-[#f1d58a]">{line.name}: </span>
                                    <span className={line.final ? '' : 'text-white/85'}>{line.text}</span>
                                  </p>
                                ))
                              ) : (
                                <p className="text-sm text-white/50">Captions appear here when someone speaks.</p>
                              )}
                            </div>
                            {captionNotice ? <p className="mt-1 text-xs text-[#f1d58a]">{captionNotice}</p> : null}
                            {!speechCaptionsSupported() ? (
                              <p className="mt-1 text-xs text-white/55">This browser can show captions but can&apos;t caption your own speech. Chrome, Edge or Safari can.</p>
                            ) : null}
                          </section>
                        ) : null}

                        <button type="button" onClick={() => void leave()} className="pr-leave" aria-label="Leave Ka Link">
                          <LogOut className="h-5 w-5 lg:h-6 lg:w-6" aria-hidden />
                          Leave Room
                        </button>
                        {canModerate ? (
                          <button type="button" onClick={() => void endForEveryone()} disabled={ending} className="pr-end -mt-2 min-h-[40px] disabled:opacity-50">
                            {ending ? 'Ending…' : 'End Ka Link for everyone'}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </>
                )}
              </main>

              <aside className="pr-side">
                <section className="pr-card">
                  <h3 className="pr-card-title">
                    <span className="pr-info-icon"><Info size={16} aria-hidden /></span>
                    Prayer Room Information
                  </h3>
                  <p className="pr-card-text">
                    {prayerWatch
                      ? 'A voice prayer call for the Intercessors.'
                      : 'The main prayer room for our worldwide family. When it fills up, PLCC Sanctum opens an overflow room.'}
                  </p>
                  <ul className="pr-rules">
                    <li><Headphones size={22} aria-hidden />{audioOnly || prayerWatch ? 'Audio only (no video)' : 'Audio first (camera optional)'}</li>
                    <li><MicOff size={22} aria-hidden />Stay muted unless you are praying aloud</li>
                    {!prayerWatch ? <li><Hand size={22} aria-hidden />Use Raise Hand to request to speak</li> : null}
                    <li><ShieldCheck size={22} aria-hidden />Please keep all prayers respectful and focused</li>
                  </ul>
                </section>

                {connected ? (
                  <section className="pr-card">
                    <div className="pr-people-head">
                      <h3 className="pr-card-title">
                        <Users className="h-6 w-6" aria-hidden />
                        Participants ({peopleCount})
                      </h3>
                      <button
                        type="button"
                        onClick={() => setPeopleSearchOpen((v) => !v)}
                        className="pr-search-btn"
                        aria-label="Search participants"
                        aria-expanded={peopleSearchOpen}
                      >
                        <Search size={20} aria-hidden />
                      </button>
                    </div>
                    {peopleSearchOpen ? (
                      <label className="pr-search">
                        <Search size={16} aria-hidden className="opacity-60" />
                        <input
                          autoFocus
                          value={peopleQuery}
                          onChange={(e) => setPeopleQuery(e.target.value)}
                          placeholder="Find someone"
                          aria-label="Find someone"
                        />
                      </label>
                    ) : null}
                    <ul className="pr-people">
                      {peopleList.map((tile) => (
                        <li key={tile.identity} className="pr-person">
                          <span className={`pr-avatar ${tile.speaking && tile.micOn ? 'is-speaking' : ''}`}>{initials(tile.name)}</span>
                          <span className="pr-person-name">
                            {tile.name}
                            {tile.isLocal ? ' (you)' : ''}
                          </span>
                          {tile.handRaised ? <Hand size={18} className="pr-hand" aria-label="Hand raised" /> : null}
                          {tile.speaking && tile.micOn ? (
                            <span className="pr-role is-speaking">Praying</span>
                          ) : tile.moderator ? (
                            <span className="pr-role is-mod"><Crown size={13} aria-hidden /> Moderator</span>
                          ) : (
                            <span className="pr-role is-member">Participant</span>
                          )}
                          {tile.micOn ? <Mic size={20} className="pr-mic-on" aria-label="Microphone on" /> : <MicOff size={20} className="pr-mic-off" aria-label="Muted" />}
                        </li>
                      ))}
                      {!peopleList.length ? <li className="py-4 text-center text-sm text-[#4a5a52]">No one matches that name.</li> : null}
                    </ul>
                    {!prayerWatch && raisedEntries.length > 0 ? (
                      <button type="button" onClick={() => setActiveTab('hands')} className="mt-3 w-full rounded-xl bg-[#d9b45e]/25 px-3 py-2.5 text-sm font-bold text-[#7a5a1c]">
                        {raisedEntries.length} hand{raisedEntries.length === 1 ? '' : 's'} raised — view
                      </button>
                    ) : null}
                  </section>
                ) : null}
              </aside>
            </div>
          </div>
        </div>

        {sheet === 'prayer' ? <PrayerRequestSheet onClose={() => setSheet(null)} roomName={title} /> : null}
        {sheet === 'guidelines' ? <GuidelinesSheet onClose={() => setSheet(null)} /> : null}

        <HuddleTabSheet tab={activeTab} onClose={() => setActiveTab(null)}>
          {activeTab === 'hands' && !prayerWatch ? (
            <HuddleHandsPanel raised={raisedEntries} handRaised={handRaised} onToggleHand={() => void toggleHand()} />
          ) : null}
          {activeTab === 'chat' ? <HuddleChatPanel messages={chatMessages} onSend={sendChat} sending={chatSending} /> : null}
          {activeTab === 'attendance' && !prayerWatch ? <HuddlePeoplePanel variant="embedded" roster={roster} title="Attendance" /> : null}
        </HuddleTabSheet>
      </div>
    );
  }

  return (
    <div
      className={`${shellClass} flex flex-col bg-[#0f0a0c] text-white`}
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label="Live Ka Link"
    >
      {conn === 'connected' && activeReactions.length > 0 ? (
        <div
          className="pointer-events-none absolute right-3 bottom-44 z-40 flex max-w-[min(14rem,46%)] flex-col-reverse items-end gap-1.5"
          data-huddle-reactions-overlay="true"
          aria-hidden="true"
        >
          {activeReactions.map((rxn) => (
            <div
              key={rxn.id}
              className="flex items-center gap-1.5 rounded-2xl border border-gold/40 bg-burgundy/90 px-2.5 py-1.5 text-gold shadow-lg animate-in fade-in zoom-in-95 duration-200"
            >
              <span className="text-lg leading-none">{rxn.emoji}</span>
              <span className="max-w-[7rem] truncate text-[11px] font-bold">
                {rxn.isLocal ? 'You' : rxn.senderName}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <header className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:pb-3 border-b border-white/10">
        <div className="min-w-0">
          <p className="hidden sm:block text-xs font-black uppercase tracking-widest text-gold">
            Live Ka Link
          </p>
          <h2 className="text-sm sm:text-base font-bold truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {conn === 'connected' && !prayerWatch ? (
            <button
              type="button"
              onClick={() => setActiveTab('attendance')}
              className="min-h-[44px] px-3 rounded-full bg-white/10 flex items-center justify-center gap-1.5"
              aria-label={`Attendance, ${inCount} in Ka Link`}
            >
              <Users size={18} aria-hidden />
              <span className="text-xs font-bold tabular-nums">{inCount || tiles.length}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void leave()}
            className="min-h-[44px] min-w-[44px] rounded-full bg-white/10 flex items-center justify-center"
            aria-label="Close Ka Link"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
      </header>

      {needSoundTap ? (
        <button
          type="button"
          onClick={() => void enableSound()}
          className="mx-3 sm:mx-4 mt-2 sm:mt-3 flex items-center justify-center gap-2 rounded-2xl bg-gold text-burgundy font-bold text-sm min-h-[44px] sm:min-h-[48px]"
        >
          <Volume2 size={18} aria-hidden />
          Enable sound
        </button>
      ) : null}

      {hostMuteNotice ? (
        <p className="mx-3 sm:mx-4 mt-2 sm:mt-3 rounded-2xl bg-burgundy px-4 py-3 text-sm text-white leading-relaxed" role="status">
          {hostMuteNotice}
        </p>
      ) : null}

      {screenError ? (
        <p className="mx-3 sm:mx-4 mt-2 sm:mt-3 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white leading-relaxed" role="alert">
          {screenError}
        </p>
      ) : null}

      {notice ? (
        <p className="mx-3 sm:mx-4 mt-2 sm:mt-3 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/85 leading-relaxed" role="status">
          {notice}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4">
        {conn === 'prejoin' || conn === 'error' ? (
          <div className="max-w-md mx-auto space-y-4 sm:space-y-5 pt-4 sm:pt-8">
            <p className="text-sm text-white/70 text-center leading-relaxed">
              {mode === 'start'
                ? 'Start a Live Ka Link for this channel. Everyone in the channel can join from their phone or computer.'
                : prayerWatch
                  ? 'Join the prayer call. Voice only.'
                  : 'Join the live room. Mute, camera, and raise hand are available.'}
              <span className="hidden sm:inline">
                {' '}
                Leaving here does not end the Ka Link for others
                {canModerate ? ' unless you end it for everyone.' : '.'}
              </span>
            </p>
            {error ? (
              <p className="text-sm text-red-300 text-center font-medium">{error}</p>
            ) : null}
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => void toggleMic()}
                className={`min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center ${
                  micEnabled ? 'bg-white/15' : 'bg-burgundy'
                }`}
                aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                aria-pressed={!micEnabled}
              >
                {micEnabled ? <Mic size={22} /> : <MicOff size={22} />}
              </button>
              {!audioOnly && (
              <button
                type="button"
                onClick={() => setCamEnabled((v) => !v)}
                className={`min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center ${
                  camEnabled ? 'bg-white/15' : 'bg-white/5'
                }`}
                aria-label={camEnabled ? 'Camera on at join' : 'Camera off at join'}
                aria-pressed={camEnabled}
              >
                {camEnabled ? <Video size={22} /> : <VideoOff size={22} />}
              </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => void join()}
              className="w-full min-h-[48px] sm:min-h-[52px] rounded-2xl bg-burgundy text-white font-bold text-base"
            >
              {mode === 'start' ? 'Start Ka Link' : 'Join Ka Link'}
            </button>
            <button
              type="button"
              onClick={() => void leave()}
              className="w-full min-h-[44px] text-sm text-white/60 font-medium"
            >
              Not now
            </button>
          </div>
        ) : null}

        {conn === 'connecting' || conn === 'reconnecting' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-white/70">
            <Loader2 className="animate-spin" size={28} aria-hidden />
            <p className="text-sm font-medium">
              {conn === 'reconnecting'
                ? 'Reconnecting…'
                : mode === 'start'
                  ? 'Starting Ka Link…'
                  : 'Joining Ka Link…'}
            </p>
          </div>
        ) : null}

        {conn === 'connected' ? (
          <div className="space-y-3">
            {raisedNames.length > 0 && !prayerWatch ? (
              <div
                className="sticky top-0 z-20 rounded-2xl bg-gold/15 border border-gold/40 px-3 py-2.5 backdrop-blur-md"
                data-testid="hands-raised-strip"
              >
                <p className="text-xs font-black uppercase tracking-widest text-gold flex items-center gap-1.5">
                  <Hand size={14} aria-hidden /> Hands raised
                </p>
                <p className="text-xs font-bold text-white mt-1 leading-snug">{raisedNames.join(', ')}</p>
              </div>
            ) : null}
            {sharer && participantFor(sharer.identity) ? (
              <ScreenShareStage participant={participantFor(sharer.identity)!} sharer={sharer} />
            ) : null}
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 max-w-5xl mx-auto">
              {tiles.map((tile) => {
                const participant = participantFor(tile.identity);
                return (
                  <li
                    key={tile.identity}
                    className={`relative aspect-square rounded-xl overflow-hidden bg-white/10 border ${
                      tile.speaking ? 'border-gold' : 'border-white/10'
                    }`}
                  >
                    {tile.camOn && participant ? (
                      <ParticipantVideo
                        participant={participant}
                        isLocal={tile.isLocal}
                        camOn={tile.camOn}
                      />
                    ) : (
                      <div className="absolute inset-0 z-0 flex items-center justify-center">
                        <span className="w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-burgundy/80 flex items-center justify-center text-sm sm:text-base font-bold">
                          {(tile.name[0] || 'M').toUpperCase()}
                        </span>
                      </div>
                    )}
                    {tile.handRaised ? (
                      <div
                        className="absolute top-2 right-2 z-20 min-h-[36px] min-w-[36px] rounded-full bg-gold text-burgundy shadow-lg flex items-center justify-center"
                        aria-label="Hand raised"
                      >
                        <Hand size={18} aria-hidden />
                      </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 z-10 p-1.5 sm:p-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
                      <p className="text-xs sm:text-xs font-bold truncate">
                        {tile.name}
                        {tile.isLocal ? ' (you)' : ''}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-white/80">
                        {tile.micOn ? <Mic size={12} /> : <MicOff size={12} />}
                        {tile.handRaised ? <Hand size={12} className="text-gold" /> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {conn === 'connected' ? (
        <footer className="px-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:pt-3 border-t border-white/10 space-y-2">
          {error ? (
            <p className="text-xs text-red-300 text-center">{error}</p>
          ) : null}
          {reactionError ? (
            <p className="text-xs text-amber-200 text-center" role="status">
              {reactionError}
            </p>
          ) : null}
          {musicError ? (
            <p className="text-xs text-amber-200 text-center" role="status" data-huddle-music-error="true">
              {musicError}
            </p>
          ) : null}
          {musicActive ? (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-lg bg-gold/20 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-gold"
                role="status"
                data-huddle-music-active="true"
              >
                <Music size={12} aria-hidden />
                Music playing
              </span>
              {musicPlaying && canPlayHuddleMusic ? (
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-white/80">
                  <span className="whitespace-nowrap">Music volume</span>
                  <input
                    type="range"
                    min={HUDDLE_MUSIC_MIN_VOLUME}
                    max={HUDDLE_MUSIC_MAX_VOLUME}
                    step={0.01}
                    value={musicVolume}
                    onChange={(e) => setHuddleMusicVolume(Number(e.target.value))}
                    className="w-28 accent-[#C9A35A]"
                    aria-label="Music volume"
                    data-huddle-music-volume="true"
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          <HuddleMobileTabs
            active={activeTab}
            onChange={setActiveTab}
            handsCount={raisedEntries.length}
            chatUnread={chatUnread}
            attendanceCount={inCount || tiles.length}
            tabs={prayerWatch ? ['chat'] : ['hands', 'chat']}
            action={
              prayerWatch
                ? undefined
                : { label: 'Share', Icon: Share2, onClick: () => void shareHuddle(), doneLabel: shareDone }
            }
          />
          {captionsOn && !prayerWatch ? (
            <section
              aria-label="Live captions"
              className="max-w-3xl mx-auto w-full rounded-2xl bg-black/70 border border-white/10 px-3 py-2.5"
              data-testid="huddle-captions"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gold">Live captions</p>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
                  I speak
                  <select
                    value={captionLang}
                    onChange={(e) => setCaptionLang(e.target.value as CaptionLanguage)}
                    className="min-h-[32px] rounded-lg bg-white/10 px-2 text-xs font-bold text-white [&>option]:text-black"
                  >
                    {CAPTION_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                        {l.note ? ` (${l.note})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div aria-live="polite" className="min-h-[2.75rem] space-y-0.5">
                {shownCaptions.length ? (
                  shownCaptions.map((line) => (
                    <p key={line.identity} className="text-sm sm:text-base leading-snug text-white">
                      <span className="font-bold text-gold">{line.name}: </span>
                      <span className={line.final ? '' : 'text-white/85'}>{line.text}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-white/50">Captions appear here when someone speaks.</p>
                )}
              </div>
              {captionNotice ? <p className="mt-1 text-xs text-gold/90">{captionNotice}</p> : null}
              {!speechCaptionsSupported() ? (
                <p className="mt-1 text-xs text-white/55">
                  This browser can show captions but can&apos;t caption your own speech. Chrome, Edge or Safari can.
                </p>
              ) : null}
            </section>
          ) : null}
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => void toggleMic()}
              className={`min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center ${
                micEnabled ? 'bg-white/15' : 'bg-burgundy'
              }`}
              aria-label={micEnabled ? 'Mute' : 'Unmute'}
            >
              {micEnabled ? <Mic size={22} /> : <MicOff size={22} />}
            </button>
            {!audioOnly && (
            <button
              type="button"
              onClick={() => void toggleCam()}
              className={`min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center ${
                camEnabled ? 'bg-white/15' : 'bg-white/5'
              }`}
              aria-label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {camEnabled ? <Video size={22} /> : <VideoOff size={22} />}
            </button>
            )}
            {!prayerWatch ? (
              <button
                type="button"
                onClick={() => setCaptionsOn((v) => !v)}
                className={`min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center ${
                  captionsOn ? 'bg-gold text-burgundy' : 'bg-white/10 text-white'
                }`}
                aria-label={captionsOn ? 'Turn live captions off' : 'Turn live captions on'}
                aria-pressed={captionsOn}
                data-testid="huddle-captions-toggle"
              >
                {captionsOn ? <CaptionsOff size={22} aria-hidden /> : <Captions size={22} aria-hidden />}
              </button>
            ) : null}
            {canModerate && !audioOnly && !prayerWatch && screenShareSupported() ? (
              <button
                type="button"
                onClick={() => void toggleScreenShare()}
                disabled={screenBusy || Boolean(sharer && !sharer.isLocal)}
                title={sharer && !sharer.isLocal ? `${sharer.name} is sharing` : undefined}
                className={`min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center disabled:opacity-50 ${
                  sharer?.isLocal ? 'bg-gold text-burgundy' : 'bg-white/10 text-white'
                }`}
                aria-label={sharer?.isLocal ? 'Stop sharing your screen' : 'Share your screen'}
                aria-pressed={Boolean(sharer?.isLocal)}
                data-testid="huddle-screen-share-toggle"
              >
                {screenBusy ? (
                  <Loader2 size={22} className="animate-spin" aria-hidden />
                ) : sharer?.isLocal ? (
                  <MonitorOff size={22} aria-hidden />
                ) : (
                  <Monitor size={22} aria-hidden />
                )}
              </button>
            ) : null}
            {!prayerWatch ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setReactionError(null);
                    setReactionPickerOpen((open) => !open);
                  }}
                  disabled={reactionBusy}
                  className={`min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl flex items-center justify-center disabled:opacity-60 ${
                    reactionPickerOpen ? 'bg-gold text-burgundy' : 'bg-white/10 text-white'
                  }`}
                  aria-label="Open Ka Link reactions"
                  aria-expanded={reactionPickerOpen}
                  aria-haspopup="menu"
                  data-huddle-reaction-control="true"
                >
                  <Smile size={22} aria-hidden />
                </button>
                {reactionPickerOpen ? (
                  <div
                    role="menu"
                    aria-label="Ka Link reactions"
                    className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-50 w-52 -translate-x-1/2 rounded-2xl border border-white/15 bg-[#0c110f] p-2 shadow-xl"
                  >
                    <p className="px-2 pb-1.5 text-xs font-black uppercase tracking-[0.2em] text-gold">
                      Reactions
                    </p>
                    <div className="grid grid-cols-1 gap-1">
                      {HUDDLE_REACTION_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          role="menuitem"
                          disabled={reactionBusy}
                          onClick={() => void sendHuddleReaction(opt.key)}
                          className="flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 text-left text-[13px] font-bold text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-40"
                          aria-label={opt.label}
                        >
                          <span className="text-lg leading-none" aria-hidden>
                            {opt.emoji}
                          </span>
                          <span>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {canPlayHuddleMusic ? (
              <button
                type="button"
                onClick={() => void toggleHuddleMusic()}
                disabled={musicBusy || (musicActive && !musicPlaying)}
                className={`min-h-[44px] sm:min-h-[52px] px-3 sm:px-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold disabled:opacity-60 ${
                  musicPlaying || musicActive ? 'bg-gold text-burgundy' : 'bg-white/10 text-white'
                }`}
                aria-label={
                  musicActive && !musicPlaying
                    ? 'Music is already playing'
                    : huddleMusicButtonLabel(musicPlaying)
                }
                aria-pressed={musicPlaying}
                data-huddle-music-control="true"
              >
                {musicBusy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Music size={18} aria-hidden />}
                <span>{huddleMusicButtonLabel(musicPlaying, musicActive)}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void leave()}
              className="min-h-[44px] min-w-[44px] sm:min-h-[52px] sm:min-w-[52px] rounded-2xl bg-red-600 flex items-center justify-center"
              aria-label="Leave Ka Link"
            >
              <PhoneOff size={22} />
            </button>
          </div>
          {canModerate ? (
            <button
              type="button"
              onClick={() => void endForEveryone()}
              disabled={ending}
              className="w-full min-h-[40px] sm:min-h-[44px] text-xs sm:text-sm font-bold text-red-300/90 disabled:opacity-50"
            >
              {ending ? 'Ending…' : 'End Ka Link for everyone'}
            </button>
          ) : null}
        </footer>
      ) : null}

      <HuddleTabSheet tab={activeTab} onClose={() => setActiveTab(null)}>
        {activeTab === 'hands' && !prayerWatch ? (
          <HuddleHandsPanel
            raised={raisedEntries}
            handRaised={handRaised}
            onToggleHand={() => void toggleHand()}
          />
        ) : null}
        {activeTab === 'chat' ? (
          <HuddleChatPanel
            messages={chatMessages}
            onSend={sendChat}
            sending={chatSending}
          />
        ) : null}
        {activeTab === 'attendance' && !prayerWatch ? (
          <HuddlePeoplePanel
            variant="embedded"
            roster={roster}
            title="Attendance"
          />
        ) : null}
      </HuddleTabSheet>
    </div>
  );
};
