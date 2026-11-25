import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LazyChunkErrorBoundary } from '../routing/LazyChunkErrorBoundary.jsx';
import { setCallActive } from '../../lib/staleBuild';
import {
  onPageClosing,
  reportHuddleActivity,
  reportIssue,
  type HuddleActivityCode,
  type IssueExtra,
} from '../../lib/issueReport';
import type { BibleSelection } from '../bible/BibleReader';

const BibleReader = lazy(() => import('../bible/BibleReader').then((m) => ({ default: m.BibleReader })));
import {
  ShieldBan,
  BookHeart,
  BookOpen,
  RefreshCw,
  Captions,
  CircleHelp,
  CircleDot,
  Disc,
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
  Minimize2,
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
  MoreHorizontal,
  PhoneCall,
  SignalLow,
  Gauge,
} from 'lucide-react';
import {
  ConnectionState,
  AudioPresets,
  VideoPresets,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
  DisconnectReason,
} from 'livekit-client';
import {
  KA_LINK_AWAY_TOPIC,
  KA_LINK_BACK_MUTED_NOTICE,
  KA_LINK_WEAK_SIGNAL_NOTICE,
  awayLabel,
  decodeAwayWire,
  encodeAwayWire,
  readDataSaver,
  shouldSubscribeTrack,
  signalLabel,
  signalLevel,
  subscribeDataSaver,
  writeDataSaver,
  type AwayReason,
  type SignalLevel,
} from '../../lib/kaLinkDataSaver';
import { startNativeCall, stopNativeCall } from '../../lib/nativeShell';
import { CommunityChatError } from '../../lib/communityChatTypes';
import {
  endHuddle,
  listKaLinkSongs,
  moderateHuddle,
  setHuddleRecording,
  type HuddleModerateAction,
  type KaLinkSong,
} from '../../lib/communityChatClient';
import { DEFAULT_SONG_ID, HuddleMusicSheet } from '../huddle/HuddleMusicSheet';
import { HuddleRecordingsSheet } from '../huddle/HuddleRecordingsSheet';
import { parseHuddleHostId,
  EMPTY_HUDDLE_STAGE,
  HUDDLE_MIC_ALLOWED_NOTICE,
  HUDDLE_MIC_LOCKED_NOTICE,
  orderRaisedHands,
  parseHandRaisedAt,
  parseHuddleStageView,
  type HuddleStageView,
} from '../../lib/huddleStage';
import { ModeratorRoomBar, PersonActionsSheet } from '../huddle/HuddleModeratorTools';
import { AskMuteCard, AskUnmuteCard, ConductNoticeModal, ConductSheet } from '../conduct/ConductSheet';
import { HUDDLE_CONDUCT_TOPIC, isConductTargetId, parseConductNotice, type ConductNotice, type ConductTarget } from '../../lib/memberConduct';
import { VAULT_URL } from '../../lib/appLinks';
import { GuidelinesSheet, PrayerRequestSheet } from './PrayerRoomSheets';
import { findSanctumOverflow, isRoomFullError, OVERFLOW_DASHBOARD_URL, overflowMoveHref, type SanctumOverflow } from '../../lib/sanctumOverflow';
import { useAuth } from '../../context/AuthContext';
import {
  claimHuddleLine,
  fetchDailyCredentials,
  fetchHuddleTokenResilient,
  planHuddleLine,
  rememberLiveKitQuota,
  type DailyCredentials,
} from '../../lib/huddleFailsafe';
import { connectLiveKitOnce, LiveKitQuotaError } from '../../lib/livekitConnect';
import { KA_LINK_RECONNECT_DELAYS_MS, kaLinkReconnectDelay } from '../../lib/kaLinkSession';
import {
  CAPTION_LANGUAGES,
  CaptionRecognizer,
  canTranscribeHere,
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
  type HuddleChatReplyRef,
  createHuddleChatId,
  decodeIncomingHuddleChat,
  encodeHuddleChatPayload,
  HUDDLE_CHAT_TOPIC,
  hydrateHuddleChatMessage,
  type HuddleChatMessage,
} from '../../lib/huddleChat';
import {
  HUDDLE_HOST_MUTE_NOTICE,
  huddleMicrophoneFailure,
  huddleMicrophonePublishAllowed,
  mergeHandMetadata,
  nextHandNo,
  parseHandNo,
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

/**
 * A join that hasn't finished after this long is stuck (usually a step that stalled while the
 * phone was in the background). Give up on it so the next rejoin isn't blocked forever.
 */
const JOIN_WATCHDOG_MS = 35_000;
const JOIN_STALLED_MESSAGE = "Couldn't reconnect to the Ka Link. Tap Reload to rejoin.";

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

/** Automatic rejoin attempts after an unexpected drop (waits grow — see lib/kaLinkSession). */
const MAX_HUDDLE_RECONNECTS = KA_LINK_RECONNECT_DELAYS_MS.length;

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
  /** When the hand went up (ms), for first-come, first-served order. */
  raisedAt: number | null;
  /** Fixed hand number for this Ka Link (kept after the hand is lowered). */
  handNo: number | null;
  /** Bible reader this session (may unmute while mics are locked). */
  reader: boolean;
  /** Ka Link team role from the server-signed token (Phase 3). */
  team: 'admin' | 'leader' | 'reader' | null;
  /** Phase 5 #30: weak or lost connection. */
  signal: SignalLevel;
  /** Phase 5 #34: on a phone call / stepped away (sent by their phone). */
  away: AwayReason | null;
};

/** Phase 3 (#18): a Ka Link team leader (e.g. Pr. Grace) tells the moderators they are ready. */
const HUDDLE_READY_TOPIC = 'plcc-ready';
const READY_RESEND_MS = 30_000;
type ReadyAlert = { identity: string; name: string; at: number };

function participantTeam(p: Participant): 'admin' | 'leader' | 'reader' | null {
  const t = p.attributes?.['plcc.team'];
  return t === 'admin' || t === 'leader' || t === 'reader' ? t : null;
}

/** Only Ka Link team admins and leaders can send the ready signal. */
function teamMaySendReady(team: 'admin' | 'leader' | 'reader' | null | undefined): boolean {
  return team === 'admin' || team === 'leader';
}

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
  /**
   * Controlled minimize (set by the app-level Ka Link provider so the phone's
   * Back button minimizes the call instead of hanging up). Optional.
   */
  minimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
};

const SIDE_WIDTH_KEY = 'plcc_prayer_room_side_width_v1';
const SIDE_MIN = 288;
/** Keep at least ~420px for the room itself. */
const sideMax = () => Math.max(SIDE_MIN, Math.min(900, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 12.5 * 16 - 460));

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

/** Member seats per Ka Link room (keep in step with VOICE_ROOM_MEMBER_SEATS on the server). */
const ROOM_MEMBER_SEATS = 50;
/** Moderators get the "open the overflow" warning from this many people. */
const ROOM_FULL_WARN_AT = 40;

export const ConnectVoiceHuddle: React.FC<Props> = ({
  channelId,
  channelName,
  mode = 'join',
  onClose,
  embedded = false,
  audioOnly = false,
  prayerWatch = false,
  minimized: minimizedProp,
  onMinimizedChange,
}) => {
  const shellClass = embedded ? 'relative h-full w-full z-0 overflow-hidden rounded-3xl' : 'fixed inset-0 z-[400]';
  const { identity: me } = useAuth();
  const [conn, setConn] = useState<ConnState>('prejoin');
  const [showReconnectRetry, setShowReconnectRetry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when this huddle is on the backup line (Daily) — renders DailyBackupHuddle. */
  const [dailyCreds, setDailyCreds] = useState<DailyCredentials | null>(null);
  /** Calm status line for fail-safe moments (retrying, saved permission). */
  const [notice, setNotice] = useState<string | null>(null);
  const [hostMuteNotice, setHostMuteNotice] = useState<string | null>(null);
  /** Phase 2: mic lock + Bible readers for this session (LiveKit room metadata). */
  const [stage, setStage] = useState<HuddleStageView>(EMPTY_HUDDLE_STAGE);
  const stageRef = useRef<HuddleStageView>(EMPTY_HUDDLE_STAGE);
  const handFirstSeenRef = useRef<Map<string, number>>(new Map());
  const [modTargetId, setModTargetId] = useState<string | null>(null);
  /** Warn / Block sheet (moderators) and the notice a warned/blocked member sees. */
  const [conductTarget, setConductTarget] = useState<ConductTarget | null>(null);
  const [conductNotice, setConductNotice] = useState<ConductNotice | null>(null);
  /** A moderator tapped "Unmute their mic": I choose to unmute (Nov 20 2026). */
  const [unmuteAsked, setUnmuteAsked] = useState(false);
  /** Nov 25 2026: the host's "please mute your mic" reminder (who sent it). */
  const [muteAsked, setMuteAsked] = useState<{ by: string | null } | null>(null);
  /** Who opened this Ka Link (session host); only they send mute reminders. */
  const [hostId, setHostId] = useState<string | null>(null);
  const [myIdentity, setMyIdentity] = useState<string | null>(null);
  const [modBusy, setModBusy] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  /** Phase 3: "I'm ready" alerts moderators see, and when this leader last sent one. */
  const [readyAlerts, setReadyAlerts] = useState<ReadyAlert[]>([]);
  const [readySentAt, setReadySentAt] = useState<number | null>(null);
  /** #14: LiveKit tells every client when the room is being recorded. */
  const [isRecording, setIsRecording] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** #12 song library: what plays next, and the picker sheet. */
  const musicStartUrlRef = useRef<string | null>(null);
  const musicQueueRef = useRef<Array<{ id: string; title: string; url: string }>>([]);
  const musicIndexRef = useRef(0);
  const [nowPlaying, setNowPlaying] = useState<{ id: string; title: string } | null>(null);
  const [musicSheetOpen, setMusicSheetOpen] = useState(false);
  const [songs, setSongs] = useState<KaLinkSong[] | null>(null);
  const [songsLoading, setSongsLoading] = useState(false);
  const [songsError, setSongsError] = useState<string | null>(null);
  const hostMuteNoticeRef = useRef<string | null>(null);
  hostMuteNoticeRef.current = hostMuteNotice;
  const [micEnabled, setMicEnabled] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const micOperation = useRef<Room | null>(null);
  const [camEnabled, setCamEnabled] = useState(false);
  /** Phase 5 Data Saver: skip downloading other people's camera video (on by default). */
  const [dataSaver, setDataSaverState] = useState<boolean>(() => readDataSaver());
  const dataSaverRef = useRef(dataSaver);
  dataSaverRef.current = dataSaver;
  /** Camera videos available but not downloaded because Data Saver is on. */
  const [hiddenVideos, setHiddenVideos] = useState(0);
  /** Phase 5 #34: who is on a phone call or stepped away (identity → reason). */
  const awayRef = useRef<Map<string, AwayReason>>(new Map());
  /** What this phone last told the room about itself. */
  const localAwayRef = useRef<AwayReason | null>(null);
  /** The phone took our mic while it was on (phone call): keep them muted when they return. */
  const micInterruptedRef = useRef(false);
  /** Page was hidden since the last time it was visible (phone call, other app). */
  const wasHiddenRef = useRef(false);
  const weakSignalShownRef = useRef(false);
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
  /** Prayer room shrunk to a small floating bar so the chat underneath can be used. */
  const [minimizedLocal, setMinimizedLocal] = useState(false);
  const minimized = minimizedProp ?? minimizedLocal;
  const setMinimized = useCallback(
    (next: boolean) => {
      if (onMinimizedChange) onMinimizedChange(next);
      else setMinimizedLocal(next);
    },
    [onMinimizedChange]
  );
  /** The inline panel for people, scripture, and room information. */
  const [sideTab, setSideTab] = useState<'people' | 'bible' | 'info'>('people');
  const bibleTabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sideTab === 'bible' && !minimized && window.matchMedia('(max-width: 1023px)').matches) {
      bibleTabRef.current?.focus({ preventScroll: true });
    }
  }, [sideTab, minimized]);
  /** Computers: the side panel's width, set by dragging the handle between room and panel (remembered). */
  const [sideWidth, setSideWidth] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(SIDE_WIDTH_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : null;
    } catch {
      return null;
    }
  });
  const [resizing, setResizing] = useState(false);
  const [chatMessages, setChatMessages] = useState<HuddleChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatSending, setChatSending] = useState(false);
  const [title, setTitle] = useState(channelName || 'Live Ka Link');
  const [canModerate, setCanModerate] = useState(false);
  // PLCC ONE rights: only the recording team sees Record (server enforces it too).
  const [canRecordRight, setCanRecordRight] = useState<boolean | null>(null);
  const canRecord = canModerate && canRecordRight !== false;
  // Only the moderator who opened the room sends mute reminders (if no host is recorded, any moderator).
  const isHost = canModerate && (!hostId || (myIdentity !== null && hostId === myIdentity));
  const [ending, setEnding] = useState(false);
  const [shareDone, setShareDone] = useState<string | null>(null);
  /** Full-screen prayer room: listen-only mode, sheets and participant search. */
  const [listenOnly, setListenOnly] = useState(false);
  /** Set when this room is at its 50-seat cap: offer PLCC Sanctum's overflow room. */
  const [roomFull, setRoomFull] = useState<{ checking: boolean; overflow: SanctumOverflow | null } | null>(null);
  const [sheet, setSheet] = useState<'prayer' | 'guidelines' | null>(null);
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
  /** Where the Reactions button is, so the picker can float above the (sideways-scrolling) tools row. */
  const [reactionAnchor, setReactionAnchor] = useState<{ left: number; bottom: number } | null>(null);
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
  /** Each join gets a number; an older join that finishes late is ignored. */
  const joinGenRef = useRef(0);
  /** Rooms we gave up on: their late events must not touch the current call. */
  const retiredRoomsRef = useRef<WeakSet<Room>>(new WeakSet());
  const joinStallsRef = useRef(0);
  /** Issues (Account → Issues): when this call started and when the connection last wobbled. */
  const callStartedAtRef = useRef(0);
  const wobbleAtRef = useRef(0);
  const channelIdForLogRef = useRef(channelId);
  channelIdForLogRef.current = channelId;
  /** Tell church leaders' Issues page what happened (joined, left, dropped…). Never throws. */
  const logActivity = useRef(
    (code: HuddleActivityCode, extra?: IssueExtra, opts?: { immediate?: boolean }) => {
      const started = callStartedAtRef.current;
      reportHuddleActivity(
        code,
        channelIdForLogRef.current,
        {
          line: 'livekit',
          ...(started ? { durationSec: Math.round((Date.now() - started) / 1000) } : {}),
          ...(extra || {}),
        },
        opts
      );
    }
  ).current;
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
      play.catch((error: unknown) => {
        if (
          mountedRef.current &&
          audioElsRef.current.get(key) === el &&
          error instanceof DOMException &&
          error.name === 'NotAllowedError'
        ) {
          setNeedSoundTap(true);
        }
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

  /** Phase 5: download voices and screen share always; camera video only when Data Saver is off. */
  const applySubscriptions = useCallback((room: Room) => {
    const saver = dataSaverRef.current;
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        const remotePub = pub as RemoteTrackPublication;
        const want = shouldSubscribeTrack(String(remotePub.source), String(remotePub.kind), saver);
        if (remotePub.isDesired !== want) {
          try {
            remotePub.setSubscribed(want);
          } catch {
            /* track went away */
          }
        }
      }
    }
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
        raisedAt: parseHandRaisedAt(p.metadata),
        handNo: parseHandNo(p.metadata),
        // Bible reader for this session, or a standing reader from Canaan's Ka Link team.
        reader: stageRef.current.readerIds.includes(p.identity) || participantTeam(p) === 'reader',
        team: participantTeam(p),
        signal: signalLevel(p.connectionQuality),
        away: isLocal ? localAwayRef.current : awayRef.current.get(p.identity) ?? null,
      });
    };

    push(room.localParticipant, true);
    const remotes = Array.from(room.remoteParticipants.values()).sort((a, b) =>
      displayName(a).localeCompare(displayName(b))
    );
    for (const r of remotes) push(r, false);
    let hidden = 0;
    for (const r of remotes) {
      const cam = r.getTrackPublication(Track.Source.Camera);
      if (cam && !cam.isMuted && !cam.track) hidden += 1;
    }
    setHiddenVideos(hidden);
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
    micOperation.current = null;
    selfMuteIntentRef.current = false;
    if (mountedRef.current) {
      setMicBusy(false);
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

  /** Next song in the queue (after a song ends, or the Next button). Same room track, new source. */
  const advanceMusic = useCallback(() => {
    const el = musicAudioRef.current;
    const queue = musicQueueRef.current;
    if (!el || queue.length < 2) return;
    musicIndexRef.current = (musicIndexRef.current + 1) % queue.length;
    const next = queue[musicIndexRef.current];
    el.src = next.url;
    void el.play().catch(() => setMusicError('Could not play the next song.'));
    setNowPlaying({ id: next.id, title: next.title });
  }, []);
  const advanceMusicRef = useRef(advanceMusic);
  advanceMusicRef.current = advanceMusic;

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
      const audioEl = new Audio();
      // Library songs come from Supabase Storage: needed so Web Audio can read them.
      audioEl.crossOrigin = 'anonymous';
      audioEl.src = musicStartUrlRef.current || HUDDLE_MUSIC_ASSET_PATH;
      musicStartUrlRef.current = null;
      audioEl.loop = musicQueueRef.current.length <= 1;
      audioEl.addEventListener('ended', () => advanceMusicRef.current());
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
        // Phase 5 #29: everyone downloads this — keep it light on mobile data
        // (speech-level bitrate, no silence-skipping, no duplicate packets).
        audioPreset: AudioPresets.speech,
        dtx: false,
        red: false,
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

  // Music stopped (by Stop, leaving, or the track ending): clear the queue display.
  useEffect(() => {
    if (!musicPlaying) {
      musicQueueRef.current = [];
      setNowPlaying(null);
    }
  }, [musicPlaying]);

  const openMusicSheet = useCallback(() => {
    setMusicSheetOpen(true);
    setSongsError(null);
    setSongsLoading(true);
    // Fresh play links each time (they last a few hours).
    listKaLinkSongs(channelId)
      .then((list) => setSongs(list))
      .catch((e) => {
        setSongs([]);
        setSongsError(e instanceof Error ? e.message : 'Could not load the music library.');
      })
      .finally(() => setSongsLoading(false));
  }, [channelId]);

  /** Play one song, or a queue starting at `start`. Tapped by the moderator, so audio may start. */
  const playQueue = useCallback(
    (queue: Array<{ id: string; title: string; url: string }>, start = 0) => {
      if (!queue.length) return;
      musicQueueRef.current = queue;
      musicIndexRef.current = start;
      const first = queue[start];
      setNowPlaying({ id: first.id, title: first.title });
      const el = musicAudioRef.current;
      if (musicPlaying && el) {
        el.loop = queue.length <= 1;
        el.src = first.url;
        void el.play().catch(() => setMusicError('Could not play that song.'));
        return;
      }
      musicStartUrlRef.current = first.url;
      void toggleHuddleMusic();
    },
    [musicPlaying, toggleHuddleMusic]
  );

  const playSong = useCallback(
    (songId: string) => {
      if (songId === DEFAULT_SONG_ID) {
        playQueue([{ id: DEFAULT_SONG_ID, title: 'Waiting music', url: HUDDLE_MUSIC_ASSET_PATH }]);
        return;
      }
      const s = (songs || []).find((x) => x.id === songId);
      if (s?.url) playQueue([{ id: s.id, title: s.title, url: s.url }]);
    },
    [playQueue, songs]
  );

  const playAllSongs = useCallback(() => {
    const queue = (songs || []).filter((s) => s.url).map((s) => ({ id: s.id, title: s.title, url: s.url as string }));
    playQueue(queue, 0);
  }, [playQueue, songs]);

  const stopMusicFromSheet = useCallback(async () => {
    if (musicPlaying) await toggleHuddleMusic();
    musicQueueRef.current = [];
    setNowPlaying(null);
  }, [musicPlaying, toggleHuddleMusic]);

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
    try {
      await roomRef.current?.startAudio();
    } catch {
      /* the element loop below reports */
    }
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
    const gen = ++joinGenRef.current;
    const watchdog = window.setTimeout(() => {
      if (joinGenRef.current !== gen || !joinInFlightRef.current) return;
      joinGenRef.current += 1;
      joinInFlightRef.current = false;
      connectingRef.current = false;
      const stuck = roomRef.current;
      roomRef.current = null;
      if (stuck) {
        retiredRoomsRef.current.add(stuck);
        void stuck.disconnect(true).catch(() => undefined);
      }
      if (!mountedRef.current || leaveIntentionalRef.current) return;
      lostConnectionRef.current = true;
      joinStallsRef.current += 1;
      reportIssue({ area: 'huddle', code: 'huddle_join_stalled', channelId, extra: { attempt: joinStallsRef.current } });
      if (joinStallsRef.current === 1 && document.visibilityState === 'visible') {
        setConn('reconnecting');
        void joinRef.current();
        return;
      }
      setError(JOIN_STALLED_MESSAGE);
      setConn('error');
    }, JOIN_WATCHDOG_MS);
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
      if (!mountedRef.current || joinGenRef.current !== gen) return;
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
      if (!mountedRef.current || joinGenRef.current !== gen) return;
      setNotice(
        tokenPayload.fallback
          ? 'The church database is having trouble, so you joined with the permission saved from your last Ka Link. Everything in the call works as usual.'
          : null
      );
      setTitle(tokenPayload.channelName || channelName || 'Live Ka Link');
      setCanModerate(Boolean(tokenPayload.canModerate));
      setCanRecordRight(typeof tokenPayload.canRecord === 'boolean' ? tokenPayload.canRecord : null);

      // Phase 5: lighter video for mobile data — 360p camera with a 180p layer for weak signals.
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
        publishDefaults: {
          simulcast: true,
          videoEncoding: VideoPresets.h360.encoding,
          videoSimulcastLayers: [VideoPresets.h180],
          // Voices: members reported sound going off and on and a crackle when someone
          // speaks. DTX (silence skipping) cut quiet/soft voices and clicked at the start
          // of speech, so it is off; the speech preset (24 kbps) keeps data use at or
          // below the old music preset with DTX. RED re-sends audio to cover lost packets
          // on weak mobile data.
          audioPreset: AudioPresets.speech,
          dtx: false,
          red: true,
        },
        // Echo cancellation, noise suppression, auto gain and voice isolation (stated
        // explicitly so a library update can't quietly change them).
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
          channelCount: 1,
        },
      });
      roomRef.current = room;

      const onChange = () => refreshTiles(room);

      room
        .on(RoomEvent.ParticipantConnected, () => {
          // Phase 5 #34: newcomers learn we're on a call / away.
          if (localAwayRef.current) {
            void room.localParticipant
              .publishData(encodeAwayWire({ v: 1, t: 'away', r: localAwayRef.current }), { reliable: true, topic: KA_LINK_AWAY_TOPIC })
              .catch(() => undefined);
          }
          if (captionsOnRef.current) {
            void room.localParticipant
              .publishData(encodeCaptionWire({ v: 1, t: 'on' }), { reliable: true, topic: HUDDLE_CAPTION_TOPIC })
              .catch(() => undefined);
          }
          onChange();
        })
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          if (roomRef.current !== room) return;
          awayRef.current.delete(p.identity);
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
            setHostMuteNotice(stageRef.current.micLock ? HUDDLE_MIC_LOCKED_NOTICE : HUDDLE_HOST_MUTE_NOTICE);
          } else {
            // A moderator gave the mic back (Let speak / Bible reader / mics unlocked).
            if (hostMuteNoticeRef.current) setNotice(HUDDLE_MIC_ALLOWED_NOTICE);
            setHostMuteNotice(null);
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
          // A moderator's warning / block comes from Canaan (no participant).
          if (topic === HUDDLE_CONDUCT_TOPIC) {
            const notice = parseConductNotice(payload);
            if (!notice || !mountedRef.current || roomRef.current !== room) return;
            if (notice.t === 'ask-unmute') setUnmuteAsked(true);
            else if (notice.t === 'ask-mute') {
              // Already muted: nothing to ask.
              if (micEnabledRef.current) setMuteAsked({ by: notice.by ?? null });
            } else setConductNotice(notice);
            return;
          }
          if (!mountedRef.current || !participant) return;
          if (topic === KA_LINK_AWAY_TOPIC) {
            const wire = decodeAwayWire(payload);
            if (!wire) return;
            if (wire.t === 'away') awayRef.current.set(participant.identity, wire.r);
            else awayRef.current.delete(participant.identity);
            onChange();
            return;
          }
          if (topic === HUDDLE_READY_TOPIC) {
            // Only moderators see it, and only from a real team member (role is in the signed token).
            if (!canModerateRef.current || !teamMaySendReady(participantTeam(participant))) return;
            const alert: ReadyAlert = { identity: participant.identity, name: displayName(participant), at: Date.now() };
            setReadyAlerts((prev) => [...prev.filter((a) => a.identity !== alert.identity), alert].slice(-5));
            try {
              navigator.vibrate?.([120, 80, 120]);
            } catch {
              /* not supported */
            }
            return;
          }
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
          if (roomRef.current !== room) return;
          if (track.kind === Track.Kind.Audio) {
            attachRemoteAudio(huddleRemoteAudioKey(participant.identity, pub?.trackSid), track);
          }
          onChange();
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub, participant) => {
          if (roomRef.current !== room) return;
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
        .on(RoomEvent.TrackPublished, () => {
          applySubscriptions(room);
          onChange();
        })
        .on(RoomEvent.TrackUnpublished, onChange)
        // Phase 5 #30: signal strength for everyone; suggest Data Saver once if ours is weak.
        .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
          if (
            participant.identity === room.localParticipant.identity &&
            signalLevel(quality) !== 'ok' &&
            !dataSaverRef.current &&
            !weakSignalShownRef.current &&
            mountedRef.current
          ) {
            weakSignalShownRef.current = true;
            setNotice(KA_LINK_WEAK_SIGNAL_NOTICE);
          }
          onChange();
        })
        // #14: recording started/stopped (shown to everyone).
        .on(RoomEvent.RecordingStatusChanged, (recording: boolean) => {
          if (!mountedRef.current) return;
          setIsRecording(recording);
          if (recording) setNotice('This prayer is being recorded.');
        })
        // Phase 2: moderators locked/unlocked mics or changed Bible readers.
        .on(RoomEvent.RoomMetadataChanged, (metadata: string) => {
          if (mountedRef.current) setHostId(parseHuddleHostId(metadata));
          const next = parseHuddleStageView(metadata);
          stageRef.current = next;
          if (mountedRef.current) setStage(next);
          onChange();
        })
        // LiveKit's own quick resume (network blip): show it, don't hang up.
        .on(RoomEvent.Reconnecting, () => {
          if (roomRef.current !== room) return;
          wobbleAtRef.current = Date.now();
          logActivity('huddle_reconnecting', { reason: 'signal' });
          if (mountedRef.current && !connectingRef.current) setConn('reconnecting');
        })
        .on(RoomEvent.Reconnected, () => {
          if (roomRef.current !== room) return;
          if (!mountedRef.current || retiredRoomsRef.current.has(room)) return;
          const micOn = room.localParticipant.isMicrophoneEnabled;
          setMicEnabled(micOn);
          micEnabledRef.current = micOn;
          setConn('connected');
          logActivity('huddle_reconnected', {
            outageSec: wobbleAtRef.current ? Math.round((Date.now() - wobbleAtRef.current) / 1000) : undefined,
          });
          void resumeAudioRef.current();
        })
        // Phone blocked sound (autoplay rules, or audio paused by the system).
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (mountedRef.current && !room.canPlaybackAudio) setNeedSoundTap(true);
        })
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          // An old connection closing late (after the phone came back) must not end the new call.
          if (retiredRoomsRef.current.has(room) || (roomRef.current && roomRef.current !== room)) return;
          if (!mountedRef.current) return;
          if (connectingRef.current) return;
          clearRemoteAudio();
          roomRef.current = null;
          micOperation.current = null;
          selfMuteIntentRef.current = false;
          setMicBusy(false);
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
            logActivity(
              reason === DisconnectReason.DUPLICATE_IDENTITY
                ? 'huddle_other_device'
                : reason === DisconnectReason.PARTICIPANT_REMOVED
                  ? 'huddle_removed'
                  : 'huddle_ended_for_all'
            );
            callStartedAtRef.current = 0;
            // Foreground recovery is only for temporary connection loss.
            lostConnectionRef.current = false;
            setError(huddleDisconnectMessage(reason));
            setConn('error');
            return;
          }
          logActivity('huddle_dropped', {
            reason: typeof reason === 'number' ? String((DisconnectReason as any)[reason] || reason) : undefined,
          });
          // Phone has no network (weak data, or a phone call took the line):
          // wait for it to come back — the 'online' / return listener rejoins.
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            lostConnectionRef.current = true;
            setConn('reconnecting');
            return;
          }
          const delay = kaLinkReconnectDelay(reconnectAttemptsRef.current);
          if (delay === null) {
            lostConnectionRef.current = true;
            reportIssue({ area: 'huddle', code: 'huddle_disconnected', channelId });
            setError('Connection lost. Tap to rejoin the Ka Link.');
            setConn('error');
            return;
          }
          reconnectAttemptsRef.current += 1;
          setConn('reconnecting');
          window.setTimeout(() => {
            if (!mountedRef.current || leaveIntentionalRef.current || roomRef.current) return;
            void joinRef.current();
          }, delay);
        });

      connectingRef.current = true;
      try {
        // 3. One connect; a LiveKit 429 (out of minutes) throws LiveKitQuotaError.
        await connectLiveKitOnce(room, tokenPayload.url, tokenPayload.token, { autoSubscribe: false });
      } finally {
        connectingRef.current = false;
      }
      if (!mountedRef.current || joinGenRef.current !== gen) {
        retiredRoomsRef.current.add(room);
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
      // Video only for moderators and the Ka Link team (Pr. Grace); members join audio-only.
      const mayUseCamera = Boolean(tokenPayload.canModerate);
      if (camEnabled && mayUseCamera) {
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          setError('Camera could not be enabled. You can still join with audio.');
        }
      } else if (camEnabled) {
        setCamEnabled(false);
      }

      // Phase 5: pick what to download (Data Saver skips camera video).
      applySubscriptions(room);
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.kind === Track.Kind.Audio && pub.track) {
            attachRemoteAudio(huddleRemoteAudioKey(p.identity, pub.trackSid), pub.track as RemoteTrack);
          }
        }
      }

      setIsRecording(Boolean(room.isRecording));
      const joinedStage = parseHuddleStageView(room.metadata);
      setHostId(parseHuddleHostId(room.metadata));
      setMyIdentity(room.localParticipant.identity || null);
      stageRef.current = joinedStage;
      setStage(joinedStage);
      if (!huddleMicrophonePublishAllowed(room.localParticipant.permissions) && joinedStage.micLock) {
        setHostMuteNotice(HUDDLE_MIC_LOCKED_NOTICE);
      }
      refreshTiles(room);
      reconnectAttemptsRef.current = 0;
      joinStallsRef.current = 0;
      lostConnectionRef.current = false;
      if (!callStartedAtRef.current) callStartedAtRef.current = Date.now();
      logActivity('huddle_joined', reconnecting ? { attempt: 1 } : undefined);
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
      // A join we already gave up on: the current call (if any) isn't ours to close.
      if (joinGenRef.current !== gen) return;
      await disconnectRoom();
      if (!mountedRef.current || joinGenRef.current !== gen) return;
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
        reportIssue({ area: 'huddle', code: 'huddle_room_full', channelId });
        setError('This prayer room is full.');
        setRoomFull({ checking: true, overflow: null });
        setConn('error');
        void findSanctumOverflow(channelId).then((overflow) => {
          if (mountedRef.current) setRoomFull({ checking: false, overflow });
        });
        return;
      }
      reportIssue({
        area: 'huddle',
        code: err instanceof CommunityChatError ? `huddle_join_${err.code}`.slice(0, 64) : 'huddle_connect_failed',
        status: err instanceof CommunityChatError ? err.status : null,
        message: err instanceof Error ? err.message.slice(0, 300) : null,
        channelId,
      });
      const message =
        err instanceof CommunityChatError
          ? err.message
          : 'Could not join the Ka Link. Please try again.';
      setError(message);
      setConn('error');
    } finally {
      window.clearTimeout(watchdog);
      if (joinGenRef.current === gen) joinInFlightRef.current = false;
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
    applySubscriptions,
  ]);

  useEffect(() => {
    joinRef.current = () => join({ reconnect: true });
  }, [join]);

  useEffect(() => {
    if (conn !== 'reconnecting') {
      setShowReconnectRetry(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReconnectRetry(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [conn]);

  const retryConnection = useCallback(async () => {
    const room = roomRef.current;
    if (joinInFlightRef.current || !room || retiredRoomsRef.current.has(room) || room.state === ConnectionState.Connected) return;
    setShowReconnectRetry(false);
    retiredRoomsRef.current.add(room);
    lostConnectionRef.current = false;
    await disconnectRoom();
    if (!mountedRef.current || leaveIntentionalRef.current) return;
    reconnectAttemptsRef.current = 0;
    await joinRef.current();
  }, [disconnectRoom]);

  // Phones drop the call when the screen sleeps or the member switches tabs.
  // When they come back, rejoin on their own instead of leaving them kicked out.
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState !== 'visible') return;
      if (!mountedRef.current || leaveIntentionalRef.current) return;
      // The phone closed the call while away but no 'disconnected' arrived: drop it and rejoin.
      const dead = roomRef.current;
      if (dead && dead.state === ConnectionState.Disconnected && !joinInFlightRef.current) {
        retiredRoomsRef.current.add(dead);
        roomRef.current = null;
        clearRemoteAudio();
        lostConnectionRef.current = true;
      }
      if (!lostConnectionRef.current) return;
      lostConnectionRef.current = false;
      reconnectAttemptsRef.current = 0;
      setError(null);
      setConn('reconnecting');
      logActivity('huddle_auto_rejoin');
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
  }, [clearRemoteAudio]);

  /**
   * Bring sound and mic back after the phone interrupted the call (incoming
   * phone call, app switch, Bluetooth change). Phones pause our audio elements
   * and can end the mic track; the call itself is still connected.
   */
  const resumeAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !mountedRef.current) return;
    let blocked = false;
    try {
      await room.startAudio();
    } catch {
      blocked = true;
    }
    const cameBack = wasHiddenRef.current;
    for (const el of audioElsRef.current.values()) {
      // iPhones: after the background, audio can keep "playing" with no sound. Re-attach it.
      if (cameBack && el.srcObject) {
        const stream = el.srcObject;
        el.srcObject = null;
        el.srcObject = stream;
      } else if (!el.paused) continue;
      try {
        await el.play();
      } catch {
        blocked = true;
      }
    }
    if (blocked || !room.canPlaybackAudio) setNeedSoundTap(true);
    else setNeedSoundTap(false);

    // Phase 5 #34: a phone call took the mic — they stay muted until they tap Unmute.
    if (micInterruptedRef.current) {
      micInterruptedRef.current = false;
      setNotice(KA_LINK_BACK_MUTED_NOTICE);
      return;
    }
    // Mic: only repair it if the member had it on — never unmute someone.
    if (!micEnabledRef.current) return;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track as LocalAudioTrack | undefined;
    const media = track?.mediaStreamTrack;
    if (!track || !media) return;
    if (media.readyState === 'ended' || media.muted) {
      if (wasHiddenRef.current) {
        // Came back from a call or another app: don't switch their mic back on by itself.
        selfMuteIntentRef.current = true;
        try {
          await room.localParticipant.setMicrophoneEnabled(false);
        } catch {
          /* ignore */
        } finally {
          selfMuteIntentRef.current = false;
        }
        setMicEnabled(false);
        micEnabledRef.current = false;
        setNotice(KA_LINK_BACK_MUTED_NOTICE);
        return;
      }
      try {
        await track.restartTrack();
      } catch {
        selfMuteIntentRef.current = true;
        try {
          await room.localParticipant.setMicrophoneEnabled(false);
        } catch {
          /* ignore */
        } finally {
          selfMuteIntentRef.current = false;
        }
        setMicEnabled(false);
        micEnabledRef.current = false;
        setNotice('Your microphone was interrupted. Tap Unmute to speak again.');
      }
    }
  }, []);
  const resumeAudioRef = useRef(resumeAudio);
  resumeAudioRef.current = resumeAudio;

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      void resumeAudioRef.current();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);
    window.addEventListener('focus', onReturn);
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    devices?.addEventListener?.('devicechange', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
      window.removeEventListener('focus', onReturn);
      devices?.removeEventListener?.('devicechange', onReturn);
    };
  }, []);

  // App swiped away / phone closed the page during a call: note it for Issues.
  useEffect(
    () =>
      onPageClosing(() => {
        if (roomRef.current) logActivity('huddle_app_closed', undefined, { immediate: true });
      }),
    [logActivity]
  );

  // Back pressed before joining: nothing to keep, so just close.
  useEffect(() => {
    if (minimized && conn === 'prejoin') onClose();
  }, [conn, minimized, onClose]);

  // In a call: an app update must not reload the page (it hung up the call the first time
  // someone opened the Bible after a deploy). Load the Bible now, from this same version.
  const inCall = conn === 'connected' || conn === 'reconnecting' || conn === 'connecting';
  useEffect(() => {
    if (!inCall) return;
    setCallActive(true);
    return () => setCallActive(false);
  }, [inCall]);
  useEffect(() => {
    void import('../bible/BibleReader').catch(() => undefined);
    void import('../../pages/BiblePage').catch(() => undefined);
  }, []);

  const leave = useCallback(async () => {
    if (roomRef.current) logActivity('huddle_left');
    callStartedAtRef.current = 0;
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

  // ---------------------------------------------------------------------------
  // Phase 5: Data Saver, phone calls / stepping away, lock-screen controls
  // ---------------------------------------------------------------------------

  const setDataSaver = useCallback((on: boolean) => {
    writeDataSaver(on);
    setDataSaverState(on);
  }, []);

  // Data Saver changed (here, in Messages, or in another tab): re-pick downloads.
  useEffect(() => subscribeDataSaver((on) => setDataSaverState(on)), []);
  useEffect(() => {
    const room = roomRef.current;
    if (!room || conn !== 'connected') return;
    applySubscriptions(room);
    refreshTiles(room);
  }, [dataSaver, conn, applySubscriptions, refreshTiles]);

  /** Tell the room we're on a call / away (null = back). */
  const sendAway = useCallback(
    (reason: AwayReason | null) => {
      if (localAwayRef.current === reason) return;
      localAwayRef.current = reason;
      const room = roomRef.current;
      if (!room) return;
      const wire = reason ? ({ v: 1, t: 'away', r: reason } as const) : ({ v: 1, t: 'back' } as const);
      void room.localParticipant
        .publishData(encodeAwayWire(wire), { reliable: true, topic: KA_LINK_AWAY_TOPIC })
        .catch(() => undefined);
      refreshTiles(room);
    },
    [refreshTiles]
  );
  const sendAwayRef = useRef(sendAway);
  sendAwayRef.current = sendAway;

  // The phone took the mic (incoming phone call): mute them and say so.
  useEffect(() => {
    if (conn !== 'connected' || !micEnabled) return;
    const room = roomRef.current;
    const pub = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    const media = (pub?.track as LocalAudioTrack | undefined)?.mediaStreamTrack;
    if (!room || !media) return;
    const onTaken = () => {
      if (!micEnabledRef.current || roomRef.current !== room) return;
      micInterruptedRef.current = true;
      sendAwayRef.current('call');
      logActivity('huddle_interrupted', { reason: 'mic_taken' });
      selfMuteIntentRef.current = true;
      void room.localParticipant
        .setMicrophoneEnabled(false)
        .catch(() => undefined)
        .finally(() => {
          selfMuteIntentRef.current = false;
        });
      setMicEnabled(false);
      micEnabledRef.current = false;
    };
    media.addEventListener('mute', onTaken);
    media.addEventListener('ended', onTaken);
    return () => {
      media.removeEventListener('mute', onTaken);
      media.removeEventListener('ended', onTaken);
    };
  }, [conn, micEnabled]);

  // Left the app (screen off, another app, a text): "Listening in background" until they are back.
  useEffect(() => {
    const onVis = () => {
      if (!roomRef.current) return;
      if (document.visibilityState === 'hidden') {
        wasHiddenRef.current = true;
        if (!localAwayRef.current) sendAwayRef.current('away');
      } else {
        sendAwayRef.current(null);
        // resumeAudio (same event) reads wasHiddenRef first; clear it after.
        window.setTimeout(() => {
          wasHiddenRef.current = false;
        }, 4000);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // #21 store app (Android): "On Ka Link" notification keeps the call going in the background.
  const nativeCallLive = conn === 'connected' || conn === 'reconnecting';
  useEffect(() => {
    if (!nativeCallLive) return;
    void startNativeCall(title);
    return () => {
      void stopNativeCall();
    };
  }, [nativeCallLive, title]);

  // Lock screen / notification controls while in a Ka Link (Android; some iPhones).
  const toggleMicRef = useRef<() => void>(() => undefined);
  const leaveRef = useRef<() => void>(() => undefined);
  leaveRef.current = () => void leave();
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms || conn !== 'connected') return;
    try {
      if (typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({
          title: title || 'Live Ka Link',
          artist: 'PLCC Ka Link',
          artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
        });
      }
    } catch {
      /* not supported */
    }
    const set = (action: string, handler: (() => void) | null) => {
      try {
        ms.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        /* this phone doesn't know that button */
      }
    };
    set('togglemicrophone', () => toggleMicRef.current());
    set('hangup', () => leaveRef.current());
    return () => {
      set('togglemicrophone', null);
      set('hangup', null);
      try {
        ms.metadata = null;
      } catch {
        /* ignore */
      }
    };
  }, [conn, title]);
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? (navigator.mediaSession as MediaSession & { setMicrophoneActive?: (a: boolean) => unknown }) : undefined;
    if (!ms?.setMicrophoneActive || conn !== 'connected') return;
    // Chrome's setMicrophoneActive returns nothing (not a Promise): calling .catch on it
    // crashed the call screen on Android (Nov 19). Never assume a Promise here.
    try {
      void Promise.resolve(ms.setMicrophoneActive(micEnabled)).catch(() => undefined);
    } catch {
      /* not supported */
    }
  }, [conn, micEnabled]);

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
      if (conn === 'prejoin' || conn === 'error') setMicEnabled((enabled) => !enabled);
      return;
    }
    if (room.state !== ConnectionState.Connected || connectingRef.current) {
      setNotice('Ka Link is reconnecting. Tap Unmute once you’re back in the room.');
      return;
    }
    if (micOperation.current === room) return;

    const next = !room.localParticipant.isMicrophoneEnabled;
    if (next && listenOnly) {
      setNotice('Turn off Listen Only before you unmute.');
      return;
    }
    if (next && !huddleMicrophonePublishAllowed(room.localParticipant.permissions)) {
      setMicEnabled(false);
      micEnabledRef.current = false;
      setHostMuteNotice(stageRef.current.micLock ? HUDDLE_MIC_LOCKED_NOTICE : HUDDLE_HOST_MUTE_NOTICE);
      return;
    }
    micOperation.current = room;
    setMicBusy(true);
    const started = Date.now();
    const slowTimer = next ? window.setTimeout(() => {
      if (roomRef.current !== room || micOperation.current !== room) return;
      setNotice('Still turning on your microphone. If Chrome is asking for access, allow it to continue.');
      reportIssue({ area: 'huddle', code: 'huddle_mic_enable_slow', channelId, extra: { durationSec: 5 } });
    }, 5_000) : undefined;
    selfMuteIntentRef.current = true;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      if (roomRef.current !== room) return;
      if (next && !room.localParticipant.isMicrophoneEnabled) throw new Error('Microphone did not publish');
      setMicEnabled(next);
      micEnabledRef.current = next;
      if (next) {
        setHostMuteNotice(null);
        micInterruptedRef.current = false;
        sendAwayRef.current(null);
      }
      refreshTiles(room);
    } catch (micError) {
      if (roomRef.current !== room) return;
      if (next) {
        setMicEnabled(false);
        micEnabledRef.current = false;
        if (!huddleMicrophonePublishAllowed(room.localParticipant.permissions)) {
          setHostMuteNotice(stageRef.current.micLock ? HUDDLE_MIC_LOCKED_NOTICE : HUDDLE_HOST_MUTE_NOTICE);
        } else {
          const failure = huddleMicrophoneFailure(micError);
          setHostMuteNotice(failure.message);
          reportIssue({ area: 'huddle', code: 'huddle_mic_enable_failed', channelId, extra: { reason: failure.reason, durationSec: Math.round((Date.now() - started) / 1000) } });
        }
      } else {
        setError('Could not change microphone.');
      }
    } finally {
      window.clearTimeout(slowTimer);
      if (micOperation.current === room) {
        micOperation.current = null;
        selfMuteIntentRef.current = false;
        if (mountedRef.current) setMicBusy(false);
      }
      if (mountedRef.current && roomRef.current === room) {
        setNotice((current) => current?.startsWith('Still turning on your microphone.') ? null : current);
      }
    }
  }, [channelId, conn, listenOnly, refreshTiles]);
  toggleMicRef.current = () => void toggleMic();

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
    conn === 'connected' && micEnabled && !prayerWatch && (captionsOn || roomWantsCaptions) && canTranscribeHere();
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
    if (!room || (!canModerateRef.current && !camEnabled)) return;
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
    if (micOperation.current) return;
    if (listenOnly) {
      setListenOnly(false);
      return;
    }
    if (micEnabled) await toggleMic();
    if (camEnabled) await toggleCam();
    setListenOnly(true);
  }, [listenOnly, micEnabled, camEnabled, toggleMic, toggleCam]);

  // While the room is full and no overflow is open yet, look again every 10 seconds.
  useEffect(() => {
    if (!roomFull || roomFull.checking || roomFull.overflow?.available) return;
    const timer = window.setInterval(() => {
      void findSanctumOverflow(channelId).then((overflow) => {
        if (mountedRef.current && overflow.available) setRoomFull({ checking: false, overflow });
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [roomFull, channelId]);

  // Nov 25 2026: once the overflow room is open, take the member straight in (same tab,
  // their name carried over). They only ever see "PLCC Ka Link · Overflow".
  const overflowHref = roomFull?.overflow?.available ? overflowMoveHref(roomFull.overflow.joinUrl, me?.name) : null;
  useEffect(() => {
    if (!overflowHref) return;
    const timer = window.setTimeout(() => {
      if (mountedRef.current) window.location.assign(overflowHref);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [overflowHref]);

  const toggleHand = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const local: LocalParticipant = room.localParticipant;
    const next = !handRaised;
    try {
      // First raise: take the next number in the room; after that keep the same number.
      const handNo = next
        ? parseHandNo(local.metadata) ??
          nextHandNo([local.metadata, ...Array.from(room.remoteParticipants.values(), (p: Participant) => p.metadata)])
        : null;
      await local.setMetadata(mergeHandMetadata(local.metadata, next, handNo));
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

  const sendChat = useCallback(async (text: string, reply?: HuddleChatReplyRef | null) => {
    const room = roomRef.current;
    if (!room) return;
    const local = room.localParticipant;
    const wire = buildHuddleChatWirePayload({
      id: createHuddleChatId(),
      text,
      reply,
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

  // #6: hands in the order they went up (first come, first served).
  // First come, first served — by fixed hand number when everyone has one.
  const raisedOrdered = useMemo(() => orderRaisedHands(tiles, handFirstSeenRef.current), [tiles]);
  const raisedNames = useMemo(
    () => raisedOrdered.map((t) => (t.isLocal ? `${t.name} (you)` : t.name)),
    [raisedOrdered]
  );
  const raisedEntries = useMemo(
    () => raisedOrdered.map((t, i) => ({ identity: t.identity, name: t.name, isLocal: t.isLocal, number: t.handNo ?? i + 1 })),
    [raisedOrdered]
  );
  // Each person's fixed hand number (from their metadata); older apps without one
  // fall back to their place in the line.
  const handPosition = useMemo(() => {
    const m = new Map<string, number>();
    raisedOrdered.forEach((t, i) => m.set(t.identity, t.handNo ?? i + 1));
    return m;
  }, [raisedOrdered]);

  /** Phase 2 moderator action; refreshes the stage from Canaan's answer. */
  const moderate = useCallback(
    async (action: HuddleModerateAction, targetIdentity?: string): Promise<boolean> => {
      setModBusy(true);
      setModError(null);
      try {
        const result = await moderateHuddle(channelId, action, targetIdentity);
        if (action === 'unmute' && result.asked) setNotice('Asked them to unmute. Their mic is unlocked; they tap Unmute when ready.');
        if (action === 'unmute-all') setNotice('Asked muted participants to unmute when ready.');
        if (action === 'remind-mute-all') {
          setNotice(result.reminded > 0
            ? `Reminded ${result.reminded} ${result.reminded === 1 ? 'person' : 'people'} with an open mic to mute.`
            : 'Nobody has an open mic right now.');
        }
        if (action === 'ask-mute') setNotice('Asked them to mute their mic.');
        const next = { micLock: result.micLock, readerIds: result.readerIds };
        if (action !== 'mute' && action !== 'unmute' && action !== 'lower-hand' && action !== 'ask-mute' && action !== 'remind-mute-all') {
          stageRef.current = next;
          setStage(next);
        }
        return true;
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : 'That did not work. Please try again.';
        setModError(message);
        // Issues: a moderator button that fails is recorded with Canaan's reason.
        reportIssue({
          area: 'huddle',
          code: `huddle_mod_${action}_failed`.slice(0, 64),
          status: err instanceof CommunityChatError ? err.status : null,
          message: message.slice(0, 300),
          channelId,
        });
        return false;
      } finally {
        setModBusy(false);
      }
    },
    [channelId]
  );
  const toggleRecording = useCallback(async () => {
    setRecordBusy(true);
    try {
      const on = await setHuddleRecording(channelId, !isRecording);
      setIsRecording(on);
      setNotice(on ? 'Recording started. Everyone sees the REC sign.' : 'Recording stopped. It will be ready in a few minutes under Recordings.');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not change the recording.');
    } finally {
      setRecordBusy(false);
    }
  }, [channelId, isRecording]);

  const sendReady = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ v: 1, t: 'ready' })), {
        reliable: true,
        topic: HUDDLE_READY_TOPIC,
      });
      setReadySentAt(Date.now());
      setNotice('The moderators were told you are ready.');
    } catch {
      setError('Could not reach the moderators. Please try again.');
    }
  }, []);
  useEffect(() => {
    if (!readySentAt) return undefined;
    const t = window.setTimeout(() => setReadySentAt(null), READY_RESEND_MS);
    return () => window.clearTimeout(t);
  }, [readySentAt]);

  const letSpeak = useCallback(
    async (identity: string): Promise<boolean> => {
      // Locked: give the mic back. Unlocked: they can already unmute. Either way, lower the hand.
      if (stageRef.current.micLock && !(await moderate('allow-mic', identity))) return false;
      return moderate('lower-hand', identity);
    },
    [moderate]
  );
  const inCount = roster.filter((e) => e.status === 'in').length;

  // Warn / Block sheet (moderators) and the warning a member must acknowledge — every layout.
  const conductOverlays = (
    <>
      {conductTarget ? <ConductSheet target={conductTarget} onClose={() => setConductTarget(null)} /> : null}
      {conductNotice && conductNotice.t !== 'ask-unmute' ? (
        <ConductNoticeModal kind={conductNotice.t} reason={conductNotice.reason} onClose={() => setConductNotice(null)} />
      ) : null}
      {muteAsked ? (
        <AskMuteCard
          by={muteAsked.by}
          onMute={() => {
            setMuteAsked(null);
            if (micEnabledRef.current) void toggleMic();
          }}
          onClose={() => setMuteAsked(null)}
        />
      ) : null}
      {unmuteAsked ? (
        <AskUnmuteCard
          onUnmute={() => {
            setUnmuteAsked(false);
            if (!micEnabledRef.current) void toggleMic();
          }}
          onClose={() => setUnmuteAsked(false)}
        />
      ) : null}
    </>
  );

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
    // Video is for Pr. Grace, the Ka Link team and moderators (Canaan enforces it too).
    const canUseCamera = canModerate;
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
          (handPosition.get(a.identity) ?? 0) - (handPosition.get(b.identity) ?? 0) ||
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
      { key: 'bible', label: 'Bible', Icon: BookOpen, onClick: () => openBible() },
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

    const handLabel = handRaised ? 'Lower Hand' : 'Raise Hand';
    const saveSideWidth = (w: number | null) => {
      try {
        if (w) localStorage.setItem(SIDE_WIDTH_KEY, String(Math.round(w)));
        else localStorage.removeItem(SIDE_WIDTH_KEY);
      } catch {
        /* private mode */
      }
    };
    const clampSide = (w: number) => Math.round(Math.min(sideMax(), Math.max(SIDE_MIN, w)));
    const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
      const panel = e.currentTarget.parentElement;
      if (!panel) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      let last = startW;
      setResizing(true);
      document.body.style.userSelect = 'none';
      const move = (ev: PointerEvent) => {
        last = clampSide(startW + (startX - ev.clientX));
        setSideWidth(last);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.userSelect = '';
        setResizing(false);
        saveSideWidth(last);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    const nudgeSide = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const current = sideWidth ?? e.currentTarget.parentElement?.getBoundingClientRect().width ?? 320;
      const next = clampSide(current + (e.key === 'ArrowLeft' ? 32 : -32));
      setSideWidth(next);
      saveSideWidth(next);
    };
    const openBible = () => setSideTab('bible');
    /** Posts the selected verses in the prayer room's chat for everyone in the room. */
    const shareVerseInRoom = async (s: BibleSelection) => {
      const head = `📖 ${s.label} · ${s.translationShort}\n`;
      const room = 500 - head.length - 2;
      const quote = s.text.length > room ? `${s.text.slice(0, room - 1).replace(/\s+\S*$/, '')}…` : s.text;
      await sendChat(`${head}“${quote}”`);
      setNotice(`${s.label} shared in the room chat.`);
      window.setTimeout(() => setNotice((cur) => (cur && cur.endsWith('shared in the room chat.') ? null : cur)), 4000);
    };
    // Its own error card: a failed Bible load never takes the call down with it.
    const bibleReader = (
      <LazyChunkErrorBoundary sectionLabel="the Bible">
        <Suspense fallback={<p className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} aria-hidden /> Opening the Bible…</p>}>
          <BibleReader
            actions={connected ? [{ label: 'Share in room', primary: true, onShare: shareVerseInRoom }] : []}
          />
        </Suspense>
      </LazyChunkErrorBoundary>
    );
    const micTileLabel = micBusy ? (micEnabled ? 'Muting…' : 'Turning mic on…') : micEnabled && !listenOnly ? 'Mute' : 'Unmute';

    const callControls = (
      <div className="pr-controls">
        {!prayerWatch ? (
          <button type="button" onClick={() => void toggleHand()} aria-pressed={handRaised} className={`pr-ctl is-gold ${handRaised ? 'is-on' : ''}`}>
            <Hand aria-hidden />
            <span>{handLabel}</span>
          </button>
        ) : (
          <button type="button" onClick={() => setActiveTab('chat')} className="pr-ctl">
            <MessageCircle aria-hidden />
            <span>Chat</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => (listenOnly || micBusy ? undefined : void toggleMic())}
          aria-pressed={micEnabled}
          aria-disabled={listenOnly || micBusy || undefined}
          title={listenOnly ? 'Listen only is on' : undefined}
          className={`pr-ctl ${micEnabled && !listenOnly ? 'is-live' : ''} ${listenOnly ? 'is-disabled' : ''}`}
        >
          {micEnabled && !listenOnly ? <Mic aria-hidden /> : <MicOff aria-hidden />}
          <span>{micTileLabel}</span>
        </button>
        <button type="button" onClick={() => void toggleListenOnly()} disabled={micBusy} aria-pressed={listenOnly} className={`pr-ctl ${listenOnly ? 'is-on' : ''}`}>
          <Volume2 aria-hidden />
          <span>Listen Only</span>
        </button>
        <span className="pr-ctl-gap" aria-hidden />
        <button type="button" onClick={() => void leave()} className="pr-ctl is-leave" aria-label="Leave Ka Link">
          <LogOut aria-hidden />
          <span>Leave Room</span>
        </button>
      </div>
    );

    // Minimized: a small floating bar; the chat underneath stays usable and the call keeps going.
    if (minimized) {
      return (
        <>
        {conductOverlays}
        <div className="pr-mini" role="region" aria-label="Live Ka Link (minimized)">
          <button type="button" onClick={() => setMinimized(false)} className="pr-mini-main" aria-label="Open the prayer room">
            <span className={`pr-mini-dot ${connected ? 'is-live' : ''}`} aria-hidden />
            <span className="min-w-0">
              <span className="pr-mini-title">{title}</span>
              <span className="pr-mini-sub">
                {connected
                  ? speakingNow.length
                    ? `Praying: ${speakingNow.slice(0, 2).join(', ')}`
                    : `${peopleCount} in the room · ${listenOnly ? 'listening' : micEnabled ? 'mic on' : 'muted'}`
                  : conn === 'reconnecting'
                    ? 'Reconnecting…'
                    : 'Not connected'}
              </span>
            </span>
          </button>
          {connected && !listenOnly ? (
            <button
              type="button"
              onClick={() => void toggleMic()}
              className={`pr-mini-btn ${micEnabled ? 'is-on' : ''}`}
              aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
              aria-pressed={micEnabled}
            >
              {micEnabled ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
            </button>
          ) : null}
          {connected && !prayerWatch ? (
            <button type="button" onClick={() => void toggleHand()} className={`pr-mini-btn ${handRaised ? 'is-gold' : ''}`} aria-label={handLabel} aria-pressed={handRaised}>
              <Hand size={18} aria-hidden />
            </button>
          ) : null}
          <button type="button" onClick={() => setMinimized(false)} className="pr-mini-btn" aria-label="Open the prayer room">
            <Maximize2 size={18} aria-hidden />
          </button>
          <button type="button" onClick={() => void leave()} className="pr-mini-btn is-leave" aria-label="Leave Ka Link">
            <LogOut size={18} aria-hidden />
          </button>
        </div>
        </>
      );
    }

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
                <p className="pr-brand-name">PLCC KA LINK</p>
                <p className="pr-brand-sub">{prayerWatch ? 'Prayer Call' : 'Main Prayer Room'}</p>
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
                  className="pr-icon-btn pr-phone-only"
                  aria-label={`Attendance, ${inCount} in Ka Link`}
                >
                  <Users size={20} aria-hidden />
                  <span className="tabular-nums">{peopleCount}</span>
                </button>
              ) : null}
              <button type="button" onClick={() => setSheet('guidelines')} className="pr-icon-btn pr-desktop-only" aria-label="Guidelines">
                <CircleHelp size={22} aria-hidden />
              </button>
              {connected || conn === 'reconnecting' ? (
                <button type="button" onClick={() => setMinimized(true)} className="pr-icon-btn" aria-label="Minimize — keep praying and use the chat">
                  <Minimize2 size={20} aria-hidden />
                  <span className="pr-desktop-only">Minimize</span>
                </button>
              ) : null}
              <button type="button" onClick={() => void leave()} className="pr-icon-btn is-solid" aria-label="Close Ka Link">
                <X size={20} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        <div className="pr-body">
          <aside className="pr-sidebar" aria-label="Prayer room">
            <nav className="pr-nav">
              {nav.map(({ key, label, Icon, onClick, active }) => (
                <button key={key} type="button" onClick={onClick} className={`pr-nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                  <Icon size={20} aria-hidden />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          <div
            className={`pr-content ${sideTab === 'bible' ? 'is-reading' : ''}`}
            style={sideWidth ? ({ '--pr-side-w': `${Math.min(sideWidth, sideMax())}px` } as React.CSSProperties) : undefined}
          >
            <main className="pr-room">
              <div className="pr-titlebar">
                <span className="pr-room-icon"><Headphones aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="pr-room-title">{title}</p>
                  <p className="pr-room-sub">{prayerWatch ? 'Prayer call • Voice only' : 'Audio Prayer Room • Main Room'}</p>
                </div>
                {connected && isRecording ? (
                  <span className="pr-rec" role="status" aria-label="This prayer is being recorded">
                    <i aria-hidden /> REC
                  </span>
                ) : connected ? (
                  <span className="pr-live"><i aria-hidden /> LIVE</span>
                ) : null}
                {connected ? (
                  <span
                    className={`pr-count ${canModerate && !prayerWatch && peopleCount >= ROOM_FULL_WARN_AT ? 'is-filling' : ''}`}
                    aria-label={canModerate && !prayerWatch ? `${peopleCount} of ${ROOM_MEMBER_SEATS} seats taken` : `${peopleCount} in the room`}
                  >
                    <Users aria-hidden /> {peopleCount}
                    {canModerate && !prayerWatch ? <span className="pr-count-cap">/{ROOM_MEMBER_SEATS}</span> : null}
                  </span>
                ) : null}
              </div>
              {connected && canModerate && !prayerWatch && peopleCount >= ROOM_FULL_WARN_AT ? (
                <section className={`pr-fill-bar ${peopleCount >= ROOM_MEMBER_SEATS ? 'is-full' : ''}`} role="status" aria-live="polite" data-testid="room-filling">
                  <p>
                    {peopleCount >= ROOM_MEMBER_SEATS ? (
                      <><strong>The room is full ({peopleCount} of {ROOM_MEMBER_SEATS}).</strong> New members are waiting for the overflow. Open it now.</>
                    ) : (
                      <><strong>The room is almost full ({peopleCount} of {ROOM_MEMBER_SEATS}).</strong> Open the overflow now so nobody waits.</>
                    )}
                  </p>
                  <a href={OVERFLOW_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="pr-fill-btn">
                    <Headphones size={16} aria-hidden /> Open overflow
                  </a>
                </section>
              ) : null}
              {connected && localTile?.team === 'leader' ? (
                <section className="pr-ready-bar" aria-label="Moderator handoff">
                  <p>Let the moderators know you’re ready to begin.</p>
                  <button
                    type="button"
                    onClick={() => void sendReady()}
                    disabled={Boolean(readySentAt)}
                    className="pr-ready-btn"
                    data-testid="huddle-ready-button"
                  >
                    <HandHeart size={18} aria-hidden />
                    {readySentAt ? 'Moderators notified' : 'I’m ready'}
                  </button>
                </section>
              ) : null}
              {/* Phase 4 (#9): on phones everyone in the room shows right under the title — no scrolling. */}
              {connected ? (
                <aside className="pr-rail" aria-label={`People in the room, ${peopleCount}`} data-testid="huddle-people-rail">
                  <ul className="pr-rail-list">
                    {peopleList.map((tile) => {
                      const pos = handPosition.get(tile.identity);
                      return (
                        <li key={tile.identity}>
                          <button
                            type="button"
                            className="pr-rail-person"
                            onClick={() => {
                              if (canModerate && !tile.isLocal) {
                                setModError(null);
                                setModTargetId(tile.identity);
                              } else {
                                setActiveTab('attendance');
                              }
                            }}
                            aria-label={`${tile.name}${tile.isLocal ? ' (you)' : ''}${tile.moderator ? ', moderator' : ''}${pos ? `, hand raised number ${pos}` : ''}${tile.micOn ? ', mic on' : ', muted'}${tile.away ? `, ${awayLabel(tile.away).toLowerCase()}` : tile.signal !== 'ok' ? `, ${signalLabel(tile.signal).toLowerCase()}` : ''}`}
                          >
                            <span className={`pr-avatar ${tile.speaking && tile.micOn ? 'is-speaking' : ''} ${tile.moderator ? 'is-mod' : ''}`}>
                              {initials(tile.name)}
                              {pos ? <span className="pr-rail-hand" aria-hidden>{pos}</span> : !tile.micOn ? <span className="pr-rail-muted" aria-hidden /> : null}
                              {tile.away ? (
                                <span className="pr-rail-status is-away" aria-hidden><PhoneCall size={10} /></span>
                              ) : tile.signal !== 'ok' ? (
                                <span className="pr-rail-status" aria-hidden><SignalLow size={10} /></span>
                              ) : null}
                            </span>
                            <span className="pr-rail-name">{tile.isLocal ? 'You' : tile.name.split(/\s+/)[0]}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </aside>
              ) : null}

              {needSoundTap ? (
                <button type="button" onClick={() => void enableSound()} className="pr-sound">
                  <Volume2 size={18} aria-hidden />
                  Tap to hear the prayer
                </button>
              ) : null}
              {canModerate && readyAlerts.length > 0
                ? readyAlerts.map((a) => (
                    <div key={a.identity} className="pr-ready-alert" role="alert" data-testid="huddle-ready-alert">
                      <HandHeart size={18} aria-hidden />
                      <span className="flex-1 min-w-0">
                        <strong>{a.name}</strong> is ready
                      </span>
                      <button
                        type="button"
                        onClick={() => setReadyAlerts((prev) => prev.filter((x) => x.identity !== a.identity))}
                        className="pr-ready-ok"
                      >
                        OK
                      </button>
                    </div>
                  ))
                : null}
              {hostMuteNotice ? <p className="pr-notice is-strong" role="status">{hostMuteNotice}</p> : null}
              {screenError ? <p className="pr-notice is-bad" role="alert">{screenError}</p> : null}
              {notice ? <p className="pr-notice" role="status">{notice}</p> : null}
              {connected && dataSaver && hiddenVideos > 0 ? (
                <div className="pr-datasaver" role="status" data-testid="ka-link-video-paused">
                  <span>Video paused to save data</span>
                  <button type="button" onClick={() => setDataSaver(false)}>Show video</button>
                </div>
              ) : null}
              {connected && sharer && participantFor(sharer.identity) ? (
                <ScreenShareStage participant={participantFor(sharer.identity)!} sharer={sharer} />
              ) : null}

              {conn === 'connecting' || conn === 'reconnecting' ? (
                <div className="pr-stage">
                  <Loader2 className="animate-spin" size={30} aria-hidden />
                  <p className="pr-hint">
                    {conn === 'reconnecting' ? 'Reconnecting…' : mode === 'start' ? 'Starting Ka Link…' : 'Joining Ka Link…'}
                  </p>
                  {conn === 'reconnecting' && showReconnectRetry && roomRef.current && !joinInFlightRef.current ? (
                    <button type="button" className="pr-tool" onClick={() => void retryConnection()}>Retry connection</button>
                  ) : null}
                </div>
              ) : roomFull ? (
                <div className="pr-full" role="status" aria-live="polite">
                  <span className="pr-full-icon"><Users className="h-8 w-8" aria-hidden /></span>
                  <p className="pr-full-title">
                    {overflowHref ? 'Taking you to the overflow room…' : 'This prayer room is full'}
                  </p>
                  <p className="pr-full-text">
                    {overflowHref ? (
                      <>
                        <strong>{title}</strong> is full, so you&apos;ll join its overflow room. You&apos;ll hear the same prayer.
                      </>
                    ) : (
                      <>
                        Every seat in <strong>{title}</strong> is taken right now.
                      </>
                    )}
                  </p>
                  {roomFull.checking ? (
                    <p className="pr-full-text inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Finding the overflow room…
                    </p>
                  ) : overflowHref ? (
                    <a href={overflowHref} className="pr-full-go" data-testid="overflow-go">
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                      Joining overflow…
                    </a>
                  ) : (
                    <p className="pr-full-text inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Waiting for the overflow room to open. Stay here and we&apos;ll take you in automatically.
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
                    {connected && raisedNames.length > 0 && !prayerWatch ? (
                      <button type="button" onClick={() => setActiveTab('hands')} className="pr-hands-strip" data-testid="hands-raised-strip">
                        <Hand size={14} aria-hidden />
                        <span className="truncate">Hands raised: {raisedNames.join(', ')}</span>
                      </button>
                    ) : null}
                    {connected && anyVideo ? (
                      <ul className="pr-videos">
                        {tiles
                          .filter((t) => t.camOn)
                          .map((tile) => {
                            const participant = participantFor(tile.identity);
                            return (
                              <li key={tile.identity} className={`pr-video ${tile.speaking ? 'is-speaking' : ''}`}>
                                {participant ? <ParticipantVideo participant={participant} isLocal={tile.isLocal} camOn={tile.camOn} /> : null}
                                <p className="absolute inset-x-0 bottom-0 z-10 truncate bg-gradient-to-t from-black/80 to-transparent p-2 text-xs font-bold text-white">
                                  {tile.name}
                                  {tile.isLocal ? ' (you)' : ''}
                                </p>
                              </li>
                            );
                          })}
                      </ul>
                    ) : (
                      <div className="pr-orb-row">
                        <span className={`pr-wave is-left ${speakingNow.length ? 'is-active' : ''}`} aria-hidden>
                          {Array.from({ length: 9 }).map((_, n) => <i key={n} style={{ animationDelay: `${n * 0.11}s` }} />)}
                        </span>
                        <button
                          type="button"
                          onClick={() => (listenOnly || micBusy ? undefined : void toggleMic())}
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
                    )}
                    <p className={`pr-status ${micEnabled && !listenOnly ? 'is-open' : ''}`}>
                      {micEnabled && !listenOnly ? <Mic size={18} aria-hidden /> : listenOnly ? <Volume2 size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
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

                  {conn === 'prejoin' || conn === 'error' ? (
                    <div className="pr-join">
                      {error ? <p className="text-center text-sm font-semibold text-[#ffb4a8]">{error}</p> : null}
                      {error === JOIN_STALLED_MESSAGE ? (
                        <button
                          type="button"
                          onClick={() => window.location.reload()}
                          className="mx-auto block rounded-full border border-white/25 px-4 py-1.5 text-sm font-semibold text-white"
                          data-testid="huddle-reload"
                        >
                          Reload
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void join()} className="pr-join-go">
                        {mode === 'start' ? 'Start Ka Link' : 'Join prayer room'}
                      </button>
                      <div className="flex items-center justify-center gap-2">
                        <button type="button" onClick={() => void leave()} className="pr-tool">
                          Not now
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {connected ? (
                    <>
                      {captionsOn && !prayerWatch ? (
                        <section aria-label="Live captions" className="pr-captions" data-testid="huddle-captions">
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
                          <div aria-live="polite" className="min-h-[2.5rem] space-y-0.5">
                            {shownCaptions.length ? (
                              shownCaptions.map((line) => (
                                <p key={line.identity} className="text-sm leading-snug">
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

                      {musicActive ? (
                        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#d9b45e]/20 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-[#f1d58a]" role="status" data-huddle-music-active="true">
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
                      {error ? <p className="text-center text-xs text-[#ffb4a8]">{error}</p> : null}
                      {reactionError ? <p className="text-center text-xs text-[#f1d58a]" role="status">{reactionError}</p> : null}
                      {musicError ? <p className="text-center text-xs text-[#f1d58a]" role="status" data-huddle-music-error="true">{musicError}</p> : null}

                      {callControls}

                      <div className="pr-tools" role="toolbar" aria-label="Ka Link tools">
                        {/* Bible stays on the bar: it switches to the inline reading panel. */}
                        <button type="button" onClick={openBible} className={`pr-tool ${sideTab === 'bible' ? 'is-on' : ''}`} title="Read the Bible" aria-label="Open the Bible">
                          <BookOpen size={17} aria-hidden /> <span>Bible</span>
                        </button>
                        {!prayerWatch ? (
                          <button type="button" onClick={() => setActiveTab('chat')} className="pr-tool is-icon relative" aria-label="Room chat" title="Chat">
                            <MessageCircle size={18} aria-hidden />
                            {chatUnread > 0 ? <span className="pr-badge pr-badge-dot">{chatUnread}</span> : null}
                          </button>
                        ) : null}
                        {!prayerWatch ? (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                setReactionError(null);
                                const r = e.currentTarget.getBoundingClientRect();
                                const w = 208;
                                setReactionAnchor({
                                  left: Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8),
                                  bottom: window.innerHeight - r.top + 8,
                                });
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
                              <Smile size={18} aria-hidden />
                            </button>
                            {reactionPickerOpen ? (
                              <div
                                role="menu"
                                aria-label="Ka Link reactions"
                                // Fixed, not absolute: on phones the tools row scrolls sideways and
                                // clipped the picker, so the emojis never showed.
                                className="fixed z-[460] w-52 rounded-2xl border border-[#eadfca] bg-white p-2 shadow-xl"
                                style={reactionAnchor ? { left: reactionAnchor.left, bottom: reactionAnchor.bottom } : { left: '50%', bottom: '8rem', transform: 'translateX(-50%)' }}
                                data-testid="huddle-reaction-picker"
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
                            {captionsOn ? <CaptionsOff size={18} aria-hidden /> : <Captions size={18} aria-hidden />}
                          </button>
                        ) : null}
                        {!audioOnly && (canUseCamera || camEnabled) ? (
                          <button
                            type="button"
                            onClick={() => void toggleCam()}
                            disabled={listenOnly}
                            className={`pr-tool is-icon ${camEnabled ? 'is-on' : ''}`}
                            aria-label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
                            title={camEnabled ? 'Camera off' : 'Camera on'}
                          >
                            {camEnabled ? <Video size={18} /> : <VideoOff size={18} />}
                          </button>
                        ) : null}
                        {isRecording && canRecord ? (
                          <button type="button" onClick={() => void toggleRecording()} disabled={recordBusy} className="pr-tool is-recording" aria-label="Stop recording" data-testid="huddle-recording-chip">
                            <CircleDot size={16} aria-hidden /> <span>REC · Stop</span>
                          </button>
                        ) : null}
                        {musicPlaying && canPlayHuddleMusic ? (
                          <button type="button" onClick={openMusicSheet} className="pr-tool is-on" aria-label="Music playing: open music">
                            <Music size={16} aria-hidden /> <span>{nowPlaying?.title ? (nowPlaying.title.length > 14 ? `${nowPlaying.title.slice(0, 13)}…` : nowPlaying.title) : 'Music on'}</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setMoreOpen(true)}
                          className={`pr-tool is-icon ${moreOpen ? 'is-on' : ''}`}
                          aria-label="More tools"
                          aria-haspopup="dialog"
                          aria-expanded={moreOpen}
                          title="More"
                          data-testid="huddle-more-tools"
                        >
                          <MoreHorizontal size={18} aria-hidden />
                        </button>
                      </div>
                      {moreOpen ? (
                        <div className="pr-sheet-backdrop" onClick={() => setMoreOpen(false)} role="presentation">
                          <div className="pr-sheet pr-more" role="dialog" aria-modal="true" aria-label="More tools" onClick={(e) => e.stopPropagation()}>
                            <div className="pr-more-head">
                              <p>More</p>
                              <button type="button" onClick={() => setMoreOpen(false)} className="pr-more-close" aria-label="Close">
                                <X size={18} aria-hidden />
                              </button>
                            </div>
                            <div className="pr-more-grid">
                              {!prayerWatch ? (
                                <button type="button" className="pr-more-item pr-phone-only" onClick={() => { setMoreOpen(false); setSheet('prayer'); }}>
                                  <HandHeart size={20} aria-hidden /> <span>Prayer Request</span>
                                </button>
                              ) : null}
                              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); setRecordingsOpen(true); }}>
                                <Disc size={20} aria-hidden /> <span>Recordings</span>
                              </button>
                              {/* Phase 5: Data Saver — pause other people's video on mobile data. */}
                              <button
                                type="button"
                                className={`pr-more-item ${dataSaver ? 'is-on' : ''}`}
                                onClick={() => setDataSaver(!dataSaver)}
                                aria-pressed={dataSaver}
                                data-testid="ka-link-data-saver"
                              >
                                <Gauge size={20} aria-hidden /> <span>{dataSaver ? 'Data Saver on' : 'Data Saver off'}</span>
                              </button>
                              {!prayerWatch ? (
                                <button type="button" className="pr-more-item" onClick={() => void shareHuddle()}>
                                  <Share2 size={20} aria-hidden /> <span>{shareDone || 'Share link'}</span>
                                </button>
                              ) : null}
                            </div>
                            {canModerate ? (
                              <>
                                <p className="pr-more-label">Host tools</p>
                                <div className="pr-more-grid">
                                  {connected && !prayerWatch ? (
                                    <a href={OVERFLOW_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="pr-more-item">
                                      <Headphones size={20} aria-hidden /> <span>Manage Overflow</span>
                                    </a>
                                  ) : null}
                                  {connected && canRecord ? (
                                    <button
                                      type="button"
                                      onClick={() => { setMoreOpen(false); void toggleRecording(); }}
                                      disabled={recordBusy}
                                      className={`pr-more-item ${isRecording ? 'is-recording' : ''}`}
                                      aria-pressed={isRecording}
                                      data-testid="huddle-record-toggle"
                                    >
                                      {recordBusy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <CircleDot size={20} aria-hidden />}
                                      <span>{isRecording ? 'Stop recording' : 'Record'}</span>
                                    </button>
                                  ) : null}
                                  {!audioOnly && !prayerWatch && screenShareSupported() ? (
                                    <button
                                      type="button"
                                      onClick={() => { setMoreOpen(false); void toggleScreenShare(); }}
                                      disabled={screenBusy || Boolean(sharer && !sharer.isLocal)}
                                      className={`pr-more-item ${sharer?.isLocal ? 'is-on' : ''}`}
                                      aria-pressed={Boolean(sharer?.isLocal)}
                                      data-testid="huddle-screen-share-toggle"
                                    >
                                      {sharer?.isLocal ? <MonitorOff size={20} aria-hidden /> : <Monitor size={20} aria-hidden />}
                                      <span>{sharer && !sharer.isLocal ? `${sharer.name} is sharing` : sharer?.isLocal ? 'Stop sharing' : 'Share screen'}</span>
                                    </button>
                                  ) : null}
                                  {canPlayHuddleMusic ? (
                                    <button
                                      type="button"
                                      onClick={() => { setMoreOpen(false); openMusicSheet(); }}
                                      disabled={musicBusy || (musicActive && !musicPlaying)}
                                      className={`pr-more-item ${musicPlaying || musicActive ? 'is-on' : ''}`}
                                      aria-pressed={musicPlaying}
                                      data-huddle-music-control="true"
                                    >
                                      <Music size={20} aria-hidden />
                                      <span>{musicPlaying ? 'Music on' : musicActive ? 'Music playing' : 'Music'}</span>
                                    </button>
                                  ) : null}
                                  <button type="button" onClick={() => { setMoreOpen(false); void endForEveryone(); }} disabled={ending} className="pr-more-item is-end">
                                    <PhoneOff size={20} aria-hidden /> <span>{ending ? 'Ending…' : 'End for everyone'}</span>
                                  </button>
                                </div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </main>

            <aside className="pr-side" aria-label="Prayer room details">
              {sideTab === 'bible' ? (
                <div className="pr-reading-controls">
                  <div className="pr-reading-summary">
                    <p className="pr-room-title">{title}</p>
                    {connected && isRecording ? <span className="pr-rec" aria-label="This prayer is being recorded"><i aria-hidden /> REC</span> : null}
                    {!isRecording && connected ? <span className="pr-live"><i aria-hidden /> LIVE</span> : null}
                    {conn === 'reconnecting' ? <span role="status" className="pr-reading-status">Reconnecting…</span> : null}
                  </div>
                  {connected ? callControls : null}
                  {notice ? <p className="pr-notice" role="status">{notice}</p> : null}
                  {error ? <p className="text-xs text-[#ffb4a8]" role="alert">{error}</p> : null}
                </div>
              ) : null}
              <div
                className={`pr-resize ${resizing ? 'is-dragging' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to make the side panel wider or narrower"
                title="Drag left or right · double-click to reset"
                tabIndex={0}
                onPointerDown={startResize}
                onKeyDown={nudgeSide}
                onDoubleClick={() => {
                  setSideWidth(null);
                  saveSideWidth(null);
                }}
              />
              <div className="pr-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={sideTab === 'people'} onClick={() => setSideTab('people')} className={`pr-tab ${sideTab === 'people' ? 'is-active' : ''}`}>
                  <Users size={16} aria-hidden /> People{connected ? ` (${peopleCount})` : ''}
                </button>
                <button ref={bibleTabRef} type="button" role="tab" aria-controls={sideTab === 'bible' ? 'huddle-bible-panel' : undefined} id="huddle-bible-tab" aria-selected={sideTab === 'bible'} onClick={openBible} className={`pr-tab ${sideTab === 'bible' ? 'is-active' : ''}`}>
                  <BookOpen size={16} aria-hidden /> Bible
                </button>
                <button type="button" role="tab" aria-selected={sideTab === 'info'} onClick={() => setSideTab('info')} className={`pr-tab ${sideTab === 'info' ? 'is-active' : ''}`}>
                  <Info size={16} aria-hidden /> Info
                </button>
              </div>

              {sideTab === 'bible' ? (
                <div id="huddle-bible-panel" role="tabpanel" aria-labelledby="huddle-bible-tab" tabIndex={0} className="pr-bible">{bibleReader}</div>
              ) : sideTab === 'people' ? (
                connected ? (
                  <>
                    <label className="pr-search">
                      <Search size={16} aria-hidden className="opacity-60" />
                      <input value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Search participants…" aria-label="Search participants" />
                    </label>
                    {canModerate ? (
                      <ModeratorRoomBar
                        micLock={stage.micLock}
                        handsCount={raisedEntries.length}
                        busy={modBusy}
                        onToggleLock={() => void moderate(stage.micLock ? 'mic-unlock' : 'mic-lock')}
                        onMuteAll={() => void moderate('mute-all')}
                        onUnmuteAll={() => void moderate('unmute-all')}
                        onLowerAll={() => void moderate('lower-all-hands')}
                        onRemindMute={isHost ? () => void moderate('remind-mute-all') : undefined}
                      />
                    ) : null}
                    {canModerate && modError && !modTargetId ? <p className="pr-notice" role="alert">{modError}</p> : null}
                    {!prayerWatch && raisedEntries.length > 0 ? (
                      <button type="button" onClick={() => setActiveTab('hands')} className="pr-hands-btn">
                        <Hand size={15} aria-hidden /> {raisedEntries.length} hand{raisedEntries.length === 1 ? '' : 's'} raised — view
                      </button>
                    ) : null}
                    <ul className="pr-people">
                      {peopleList.map((tile) => (
                        <li key={tile.identity} className="pr-person">
                          {canModerate && !tile.isLocal ? (
                            <button
                              type="button"
                              className="pr-person-btn"
                              onClick={() => {
                                setModError(null);
                                setModTargetId(tile.identity);
                              }}
                              aria-label={`Moderator options for ${tile.name}`}
                            >
                              <span className={`pr-avatar ${tile.speaking && tile.micOn ? 'is-speaking' : ''}`}>{initials(tile.name)}</span>
                              <span className="pr-person-name">{tile.name}</span>
                            </button>
                          ) : (
                            <>
                              <span className={`pr-avatar ${tile.speaking && tile.micOn ? 'is-speaking' : ''}`}>{initials(tile.name)}</span>
                              <span className="pr-person-name">
                                {tile.name}
                                {tile.isLocal ? ' (you)' : ''}
                              </span>
                            </>
                          )}
                          {tile.handRaised ? (
                            <span className="pr-hand inline-flex items-center gap-0.5 text-xs font-black" aria-label={`Hand raised, number ${handPosition.get(tile.identity) ?? ''}`}>
                              <Hand size={16} aria-hidden />
                              {handPosition.get(tile.identity) ?? ''}
                            </span>
                          ) : null}
                          {tile.speaking && tile.micOn ? (
                            <span className="pr-role is-speaking">Praying</span>
                          ) : tile.moderator ? (
                            <span className="pr-role is-mod"><Crown size={12} aria-hidden /> Mod</span>
                          ) : tile.reader ? (
                            <span className="pr-role is-reader"><BookOpen size={12} aria-hidden /> Reader</span>
                          ) : tile.team === 'leader' ? (
                            <span className="pr-role is-reader"><HandHeart size={12} aria-hidden /> Leader</span>
                          ) : null}
                          {tile.away ? (
                            <span className="pr-role is-away" data-testid="ka-link-away-badge"><PhoneCall size={12} aria-hidden /> {awayLabel(tile.away)}</span>
                          ) : tile.signal !== 'ok' ? (
                            <span className="pr-role is-weak" data-testid="ka-link-signal-badge"><SignalLow size={12} aria-hidden /> {signalLabel(tile.signal)}</span>
                          ) : null}
                          {tile.micOn ? <Mic size={17} className="pr-mic-on" aria-label="Microphone on" /> : <MicOff size={17} className="pr-mic-off" aria-label="Muted" />}
                          {canModerate && !tile.isLocal && !tile.moderator && tile.team !== 'admin' && tile.team !== 'leader' && isConductTargetId(tile.identity) ? (
                            <button
                              type="button"
                              onClick={() => setConductTarget({ userId: tile.identity, name: tile.name, place: 'call', channelId })}
                              className="ml-1 min-h-[40px] min-w-[40px] rounded-full bg-white/10 text-amber-300 flex items-center justify-center"
                              aria-label={`Warn or block ${tile.name}`}
                              data-testid="huddle-warn-block"
                            >
                              <ShieldBan size={16} aria-hidden />
                            </button>
                          ) : null}
                        </li>
                      ))}
                      {!peopleList.length ? <li className="py-4 text-center text-sm text-white/60">No one matches that name.</li> : null}
                    </ul>
                  </>
                ) : (
                  <p className="pr-side-empty">Join the prayer room to see who is here.</p>
                )
              ) : (
                <div className="pr-info">
                  <p className="pr-card-text">
                    {prayerWatch
                      ? 'A voice prayer call for the Intercessors.'
                      : 'The main prayer room for our worldwide family. When it fills up, new members are taken to its overflow room.'}
                  </p>
                  <ul className="pr-rules">
                    <li><Headphones size={18} aria-hidden />{audioOnly || prayerWatch ? 'Audio only (no video)' : 'Audio first (camera optional)'}</li>
                    <li><MicOff size={18} aria-hidden />Stay muted unless you are praying aloud</li>
                    {!prayerWatch ? <li><Hand size={18} aria-hidden />Use Raise Hand to request to speak</li> : null}
                    <li><ShieldCheck size={18} aria-hidden />Please keep all prayers respectful and focused</li>
                  </ul>
                  <div className="pr-info-links">
                    {nav.filter((n) => !n.active).map(({ key, label, Icon, onClick }) => (
                      <button key={key} type="button" onClick={onClick} className="pr-tool">
                        <Icon size={16} aria-hidden /> {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>

        {sheet === 'prayer' ? <PrayerRequestSheet onClose={() => setSheet(null)} roomName={title} /> : null}
        {musicSheetOpen && canPlayHuddleMusic ? (
          <HuddleMusicSheet
            songs={songs}
            loading={songsLoading}
            error={songsError || musicError}
            playing={musicPlaying}
            busy={musicBusy}
            nowPlayingId={nowPlaying?.id || (musicPlaying ? DEFAULT_SONG_ID : null)}
            nowPlayingTitle={nowPlaying?.title || null}
            queueLength={musicQueueRef.current.length}
            volume={musicVolume}
            onPlay={playSong}
            onPlayAll={playAllSongs}
            onNext={advanceMusic}
            onStop={() => void stopMusicFromSheet()}
            onVolume={setHuddleMusicVolume}
            onClose={() => setMusicSheetOpen(false)}
          />
        ) : null}
        {recordingsOpen ? (
          <HuddleRecordingsSheet channelId={channelId} roomName={title} canDelete={canRecord} onClose={() => setRecordingsOpen(false)} />
        ) : null}
        {sheet === 'guidelines' ? <GuidelinesSheet onClose={() => setSheet(null)} /> : null}

        <HuddleTabSheet tab={activeTab} onClose={() => setActiveTab(null)}>
          {activeTab === 'hands' && !prayerWatch ? (
            <HuddleHandsPanel
              raised={raisedEntries}
              handRaised={handRaised}
              onToggleHand={() => void toggleHand()}
              canModerate={canModerate}
              busy={modBusy}
              onLetSpeak={(id) => void letSpeak(id)}
              onLowerHand={(id) => void moderate('lower-hand', id)}
              onLowerAll={() => void moderate('lower-all-hands')}
            />
          ) : null}
          {activeTab === 'chat' ? <HuddleChatPanel messages={chatMessages} onSend={sendChat} sending={chatSending} /> : null}
          {activeTab === 'attendance' && !prayerWatch ? <HuddlePeoplePanel variant="embedded" roster={roster} title="Attendance" /> : null}
        </HuddleTabSheet>

        {conductOverlays}

        {modTargetId && canModerate
          ? (() => {
              const t = tiles.find((x) => x.identity === modTargetId);
              if (!t) return null;
              return (
                <PersonActionsSheet
                  target={{
                    identity: t.identity,
                    name: t.name,
                    micOn: t.micOn,
                    handRaised: t.handRaised,
                    moderator: t.moderator,
                    reader: t.reader,
                  }}
                  micLock={stage.micLock}
                  isHost={isHost}
                  busy={modBusy}
                  error={modError}
                  onClose={() => setModTargetId(null)}
                  onAction={async (action) => {
                    if (action === 'conduct') {
                      setConductTarget({ userId: t.identity, name: t.name, place: 'call', channelId });
                      setModTargetId(null);
                      return;
                    }
                    const done = action === 'allow-mic' ? await letSpeak(t.identity) : await moderate(action, t.identity);
                    if (done) setModTargetId(null);
                  }}
                />
              );
            })()
          : null}
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
      {conductOverlays}
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
            {error === JOIN_STALLED_MESSAGE ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mx-auto block rounded-full border border-white/25 px-4 py-1.5 text-sm font-semibold text-white"
              >
                Reload
              </button>
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
            {conn === 'reconnecting' && showReconnectRetry && roomRef.current && !joinInFlightRef.current ? (
              <button type="button" className="pr-tool" onClick={() => void retryConnection()}>Retry connection</button>
            ) : null}
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
                        {tile.away ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-200"><PhoneCall size={11} aria-hidden />{awayLabel(tile.away)}</span>
                        ) : tile.signal !== 'ok' ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-200"><SignalLow size={11} aria-hidden />{signalLabel(tile.signal)}</span>
                        ) : null}
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
            {!audioOnly && (canModerate || camEnabled) && (
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
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setReactionAnchor({
                      left: Math.min(Math.max(8, r.left + r.width / 2 - 104), window.innerWidth - 216),
                      bottom: window.innerHeight - r.top + 8,
                    });
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
                    className="fixed z-[460] w-52 rounded-2xl border border-white/15 bg-[#0c110f] p-2 shadow-xl"
                    style={reactionAnchor ? { left: reactionAnchor.left, bottom: reactionAnchor.bottom } : { left: '50%', bottom: '8rem', transform: 'translateX(-50%)' }}
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
