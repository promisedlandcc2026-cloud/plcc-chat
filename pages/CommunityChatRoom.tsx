import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Bell, BellOff, ClipboardList, CornerUpLeft, Info, Loader2, Megaphone, Pencil, Pin, Radio, Search, Send, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  CommunityChatError,
  isHuddleChannelLive,
  type CommunityChatMessage,
} from '../lib/communityChatTypes';
import {
  fetchChatMessages,
  fetchHuddleStatuses,
  fetchHuddleCanStart,
  fetchRoomInfo,
  fetchReadReceipts,
  editChatMessage,
  removeChatMessage,
  reportChatMessage,
  searchRoomMentions,
  setReaction,
  setPinned,
  searchChatMessages,
  setChatArchived,
  setRoomMuted,
  markChatChannelRead,
  sendChatMessage,
  fetchPolls,
  createPoll,
  votePoll,
  closePoll,
  fetchCards,
  shareCard,
  setEventGoing,
  serveSignup,
  fetchRequests,
  createRequest,
  updateRequest,
} from '../lib/communityChatClient';
import { RequestComposerSheet } from '../components/chat/RequestComposerSheet';
import { RequestCard } from '../components/chat/RequestCard';
import { Portal } from '../components/chat/Portal';
import { CardPickerSheet } from '../components/chat/CardPickerSheet';
import { PollComposerSheet } from '../components/chat/PollComposerSheet';
import { dmDisplayName } from '../lib/dmRecents';
import { ConnectVoiceHuddle } from '../components/community/ConnectVoiceHuddle';
import { Button } from '../components/ui/Button';
import { parseHuddleIntent } from '../lib/liveHuddles';
import { fetchIntercessorsAccess } from '../lib/intercessorsClient';
import {
  ChatAttachButton,
  MicButton,
  VoiceRecordingBar,
  useVoiceRecorder,
} from '../components/chat/ChatMediaComposer';
import { useRoomLive } from '../lib/useRoomLive';
import { ChatMessageBubble } from '../components/chat/ChatMessageBubble';
import { TypingBubble } from '../components/chat/TypingBubble';
import { MessageActions } from '../components/chat/MessageActions';
import {
  initialsOf,
  rankByRecentActivity,
  recentAuthorIds,
  activeMentionQuery,
  canEdit as canEditMessage,
  mentionHandle,
  mentionIdsInText,
  toggleReaction,
} from '../lib/chatMessageUtils';
import { POLL_MESSAGE_PREFIX, REQUEST_PREFIX, type ChatRequest, type ChatRequestAction, isCardMessageText, type ChatCard, type ChatEventCard, type ChatServeCard, type ChatMentionPerson, type ChatPinned, type ChatPoll, type ChatReader, type ChatSearchHit } from '../lib/communityChatTypes';
import { GroupInfoSheet } from '../components/chat/GroupInfoSheet';
import { CHAT_LEADER_ROLES } from '../lib/chatRoles';

/** Backup refresh when the live connection is up (it normally delivers instantly). */
const LIVE_POLL_MS = 30_000;

/** The Intercessors Prayer Watch lives in PLCC Connect. */
const PRAYER_WATCH_URL = 'https://plcc-connect.vercel.app/intercessors';
const HUDDLE_NOT_STARTED_TEXT =
  "This huddle hasn't started yet. A leader or room moderator will start it — you can join as soon as it's live.";

const POLL_MS = 5000;
const HUDDLE_POLL_MS = 10_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LocationState = {
  partnerName?: string;
  channelName?: string;
  isDm?: boolean;
};

export const CommunityChatRoomPage: React.FC = () => {
  const { channelId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [archiving, setArchiving] = useState(false);
  const locState = (location.state || {}) as LocationState;
  const { user, identity, memberAccessState } = useAuth();
  const [messages, setMessages] = useState<CommunityChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [huddleLive, setHuddleLive] = useState(false);
  const [huddleCount, setHuddleCount] = useState(0);
  const [huddleOpen, setHuddleOpen] = useState(false);
  const [huddleMode, setHuddleMode] = useState<'join' | 'start'>('join');
  const bottomRef = useRef<HTMLDivElement>(null);
  const validChannel = UUID_RE.test(channelId);
  /** Arrived from Home "Live Huddles": show a one-tap card (the tap is what lets the mic start). */
  const [huddleIntent, setHuddleIntent] = useState(() => parseHuddleIntent(location.search));
  /** True when this room is the Intercessor Channel and the member can open the Prayer Watch. */
  const [isPrayerWatchRoom, setIsPrayerWatchRoom] = useState(false);
  /** null = unknown → show Start (Vault still enforces). false = member: join only. */
  const [canStart, setCanStart] = useState<boolean | null>(null);
  /** Private live-update channel for this room (from the Vault). */
  const [roomTopic, setRoomTopic] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const [vaultRoomName, setVaultRoomName] = useState<string | null>(null);
  /** Everyone else's read position (✓✓ / "Seen by"). */
  const [readers, setReaders] = useState<ChatReader[]>([]);
  const [replyTo, setReplyTo] = useState<CommunityChatMessage | null>(null);
  const [editing, setEditing] = useState<CommunityChatMessage | null>(null);
  const [actionsFor, setActionsFor] = useState<CommunityChatMessage | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionPeople, setMentionPeople] = useState<ChatMentionPerson[]>([]);
  /** "@Ann" → Ann's id, for people picked from the list while writing. */
  const mentionPicked = useRef(new Map<string, string>());
  /** People who spoke most recently in this room come first in the @ list. */
  const recentAuthorsRef = useRef<string[]>([]);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  // Set 4: announcements, pins, search, group info
  const [announceOnly, setAnnounceOnly] = useState(false);
  const [canPost, setCanPost] = useState(true);
  const [canPin, setCanPin] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [roomVisibility, setRoomVisibility] = useState<string | null>(null);
  const [roomDescription, setRoomDescription] = useState<string | null>(null);
  const [pins, setPins] = useState<ChatPinned[]>([]);
  const [pinIndex, setPinIndex] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<ChatSearchHit[] | null>(null);
  /** ?m=<messageId> from a search result elsewhere: scroll there once loaded. */
  const [pendingJump, setPendingJump] = useState<string | null>(() => new URLSearchParams(location.search).get('m'));

  const isDm =
    Boolean(locState.isDm) ||
    Boolean(locState.partnerName) ||
    Boolean(dmDisplayName(channelId, '', identity?.id || user?.id || '')) ||
    roomVisibility === 'dm';

  const roomTitle =
    locState.partnerName ||
    vaultRoomName ||
    locState.channelName ||
    dmDisplayName(channelId, '', identity?.id || user?.id || '') ||
    (isDm ? 'Direct message' : 'Channel');

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!validChannel || memberAccessState !== 'approved_member') return;
      if (!opts?.quiet) setLoading(true);
      try {
        const list = await fetchChatMessages(channelId);
        setMessages(list);
        setError(null);
        void markChatChannelRead(channelId).catch(() => {
          /* non-blocking */
        });
      } catch (err) {
        if (!opts?.quiet) {
          const message =
            err instanceof CommunityChatError
              ? err.message
              : 'Chat is temporarily unavailable. Please try again.';
          setError(message);
        }
      } finally {
        if (!opts?.quiet) setLoading(false);
      }
    },
    [channelId, memberAccessState, validChannel]
  );

  const selfId = identity?.id || user?.id || '';
  const selfName = identity?.name || 'Someone';
  const liveSelf = React.useMemo(() => (selfId ? { id: selfId, name: selfName } : null), [selfId, selfName]);
  const loadReaders = useCallback(() => {
    if (!validChannel || memberAccessState !== 'approved_member') return;
    fetchReadReceipts(channelId)
      .then(setReaders)
      .catch(() => undefined);
  }, [channelId, memberAccessState, validChannel]);
  const live = useRoomLive({
    topic: roomTopic,
    self: liveSelf,
    onChange: () => void load({ quiet: true }),
    onRead: loadReaders,
  });
  useEffect(() => {
    loadReaders();
  }, [loadReaders, messages.length]);
  useEffect(() => {
    recentAuthorsRef.current = recentAuthorIds(messages);
  }, [messages]);

  const loadHuddle = useCallback(
    async (signal?: AbortSignal) => {
      if (!validChannel || memberAccessState !== 'approved_member' || isDm) {
        setHuddleLive(false);
        setHuddleCount(0);
        return;
      }
      try {
        const byChannel = await fetchHuddleStatuses([channelId], { signal });
        const status = byChannel[channelId];
        setHuddleLive(isHuddleChannelLive(status));
        setHuddleCount(status?.participantCount || 0);
      } catch {
        /* omit Join bar rather than fail the room */
      }
    },
    [channelId, isDm, memberAccessState, validChannel]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isDm || !validChannel || memberAccessState !== 'approved_member') return;
    let alive = true;
    setCanStart(null);
    setRoomTopic(null);
    fetchRoomInfo(channelId)
      .then(async (info) => {
        if (!alive) return;
        if (info) {
          setCanStart(info.canStart);
          setRoomTopic(info.topic);
          setMuted(info.muted);
          setVaultRoomName(info.name);
          setAnnounceOnly(info.announceOnly);
          setCanPost(info.canPost);
          setCanPin(info.canPin);
          setCanManage(info.canManage);
          setRoomVisibility(info.visibility);
          setRoomDescription(info.description);
          setPins(info.pinned);
          setPinIndex(0);
        } else {
          // Older Vault without room-info: still hide Start for members.
          const v = await fetchHuddleCanStart(channelId);
          if (alive) setCanStart(v);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [channelId, isDm, memberAccessState, validChannel]);

  const mayStart = canStart !== false;
  // Only when they came here to join a huddle (link / Live Huddles), not in every room.
  const showNotStarted = !isDm && !huddleLive && !huddleOpen && !mayStart && Boolean(huddleIntent);

  useEffect(() => {
    if (isDm || !validChannel || memberAccessState !== 'approved_member') return;
    let alive = true;
    fetchIntercessorsAccess()
      .then((a) => alive && setIsPrayerWatchRoom(a.allowed && a.roomId === channelId))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [channelId, isDm, memberAccessState, validChannel]);

  useEffect(() => {
    if (!validChannel || memberAccessState !== 'approved_member') return;

    let timer: number | null = null;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load({ quiet: true });
    };
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(tick, live.connected ? LIVE_POLL_MS : POLL_MS);
    };
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load({ quiet: true });
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, memberAccessState, validChannel, live.connected]);

  useEffect(() => {
    if (!validChannel || memberAccessState !== 'approved_member' || isDm) return;
    const controller = new AbortController();
    let timer: number | null = null;

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void loadHuddle(controller.signal);
    };
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(tick, HUDDLE_POLL_MS);
    };
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadHuddle(controller.signal);
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      void loadHuddle(controller.signal);
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isDm, loadHuddle, memberAccessState, validChannel]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Keep the typing bubble in view when it appears — only if you're already near the bottom.
  const someoneTyping = live.typers.length > 0;
  useEffect(() => {
    if (!someoneTyping) return;
    const el = bottomRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top - window.innerHeight < 220) el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [someoneTyping]);

  const onSend = async () => {
    const content = draft.trim();
    if (!content || sending || !validChannel) return;
    setSending(true);
    setError(null);
    try {
      if (editing) {
        const updated = await editChatMessage(editing.id, content);
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
        setEditing(null);
        setDraft('');
        live.notifySent(updated.id);
        return;
      }
      const created = await sendChatMessage(channelId, content, {
        parentId: replyTo?.id || null,
        mentionedUserIds: mentionIdsInText(content, mentionPicked.current),
      });
      setDraft('');
      setReplyTo(null);
      setMentionQuery(null);
      mentionPicked.current.clear();
      setMessages((prev) => [...prev, created]);
      live.notifySent(created.id);
    } catch (err) {
      const message =
        err instanceof CommunityChatError
          ? err.message
          : 'Could not send. Please try again.';
      setError(message);
    } finally {
      setSending(false);
    }
  };

  // ── Polls ───────────────────────────────────────────────────────────
  const [polls, setPolls] = useState<Record<string, ChatPoll>>({});
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const pollMessageIds = React.useMemo(
    () =>
      messages
        .filter((m) => !m.isDeleted && String(m.content || '').startsWith(POLL_MESSAGE_PREFIX))
        .map((m) => m.id)
        .slice(-100),
    [messages]
  );
  useEffect(() => {
    // Messages reload on every live update (new votes included), so refresh polls with them.
    if (!pollMessageIds.length) return;
    let alive = true;
    fetchPolls(pollMessageIds)
      .then((list) => {
        if (!alive) return;
        setPolls((prev) => {
          const next = { ...prev };
          for (const p of list) next[p.messageId] = p;
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [messages, pollMessageIds]);

  // ── Help requests ───────────────────────────────────────────────────
  const [requests, setRequests] = useState<Record<string, ChatRequest>>({});
  const [requestComposerOpen, setRequestComposerOpen] = useState(false);
  const [openRequests, setOpenRequests] = useState<ChatRequest[]>([]);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const requestMessageIds = React.useMemo(
    () => messages.filter((m) => !m.isDeleted && String(m.content || '').startsWith(REQUEST_PREFIX)).map((m) => m.id).slice(-100),
    [messages]
  );
  useEffect(() => {
    if (!requestMessageIds.length) return;
    let alive = true;
    fetchRequests({ messageIds: requestMessageIds })
      .then((list) => {
        if (!alive) return;
        setRequests((prev) => {
          const next = { ...prev };
          for (const r of list) next[r.messageId] = r;
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [messages, requestMessageIds]);
  const loadOpenRequests = useCallback(() => {
    if (!validChannel) return;
    fetchRequests({ channelId, scope: 'open' })
      .then(setOpenRequests)
      .catch(() => undefined);
  }, [channelId, validChannel]);
  useEffect(() => {
    loadOpenRequests();
  }, [loadOpenRequests, messages]);

  const onRequestAction = useCallback(
    async (r: ChatRequest, action: ChatRequestAction, extra?: { assigneeId?: string; note?: string }) => {
      try {
        const updated = await updateRequest(r.id, action, extra);
        setRequests((prev) => ({ ...prev, [updated.messageId]: updated }));
        setOpenRequests((prev) =>
          updated.status === 'new' || updated.status === 'assigned'
            ? prev.some((x) => x.id === updated.id)
              ? prev.map((x) => (x.id === updated.id ? updated : x))
              : [updated, ...prev]
            : prev.filter((x) => x.id !== updated.id)
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update that request.');
        // Someone else may have changed it — show the latest.
        const fresh = await fetchRequests({ messageIds: [r.messageId] }).catch(() => []);
        if (fresh[0]) setRequests((prev) => ({ ...prev, [r.messageId]: fresh[0] }));
      }
    },
    []
  );

  // ── Event & Serve cards ─────────────────────────────────────────────
  const [cards, setCards] = useState<Record<string, ChatCard>>({});
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const cardMessageIds = React.useMemo(
    () => messages.filter((m) => !m.isDeleted && isCardMessageText(m.content)).map((m) => m.id).slice(-100),
    [messages]
  );
  useEffect(() => {
    if (!cardMessageIds.length) return;
    let alive = true;
    fetchCards(cardMessageIds)
      .then((list) => {
        if (!alive) return;
        setCards((prev) => {
          const next = { ...prev };
          for (const c of list) next[c.messageId] = c;
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [messages, cardMessageIds]);

  const patchCard = (messageId: string, patch: (c: ChatCard) => ChatCard) =>
    setCards((prev) => (prev[messageId] ? { ...prev, [messageId]: patch(prev[messageId]) } : prev));

  const onCardGoing = useCallback(async (messageId: string, ev: ChatEventCard, going: boolean) => {
    try {
      const r = await setEventGoing(ev.id, going, messageId);
      // The same event may be shared in several messages.
      setCards((prev) => {
        const next = { ...prev };
        for (const [k, c] of Object.entries(prev) as Array<[string, ChatCard]>) {
          if (c.kind === 'event' && c.event && c.event.id === ev.id) {
            next[k] = { ...c, event: { ...c.event, going: r.going, goingCount: r.goingCount } };
          }
        }
        return next;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    }
  }, []);

  const onCardServe = useCallback(async (messageId: string, opp: ChatServeCard, action: 'signup' | 'cancel') => {
    try {
      await serveSignup(opp.id, action);
      patchCard(messageId, (c) =>
        c.kind === 'serve' && c.serve
          ? {
              ...c,
              serve: {
                ...c.serve,
                mySignup: action === 'signup' ? (c.serve.requiresApproval ? 'pending' : 'confirmed') : null,
                spotsLeft: c.serve.spotsLeft == null ? null : Math.max(0, c.serve.spotsLeft + (action === 'signup' ? -1 : 1)),
              },
            }
          : c
      );
      // Fresh counts from the Vault.
      const fresh = await fetchCards([messageId]).catch(() => []);
      if (fresh[0]) setCards((prev) => ({ ...prev, [messageId]: fresh[0] }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    }
  }, []);

  const onPollVote = useCallback(async (poll: ChatPoll, optionIds: string[]) => {
    // Show the vote right away; the live update brings the true counts.
    const apply = (p: ChatPoll, mine: string[]): ChatPoll => {
      const before = new Set(p.myVotes);
      const after = new Set(mine);
      const hadVoted = before.size > 0;
      const nowVoted = after.size > 0;
      return {
        ...p,
        myVotes: mine,
        totalVoters: Math.max(0, p.totalVoters + (nowVoted && !hadVoted ? 1 : !nowVoted && hadVoted ? -1 : 0)),
        options: p.options.map((o) => ({
          ...o,
          count: Math.max(0, o.count + (after.has(o.id) ? 1 : 0) - (before.has(o.id) ? 1 : 0)),
        })),
      };
    };
    setPolls((prev) => ({ ...prev, [poll.messageId]: apply(poll, optionIds) }));
    try {
      await votePoll(poll.id, optionIds);
      setError(null);
    } catch (err) {
      setPolls((prev) => ({ ...prev, [poll.messageId]: poll }));
      setError(err instanceof Error ? err.message : 'Could not save your vote.');
    }
  }, []);

  const onPollClose = useCallback(async (poll: ChatPoll) => {
    try {
      await closePoll(poll.id);
      setPolls((prev) => ({ ...prev, [poll.messageId]: { ...poll, closed: true } }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close that poll.');
    }
  }, []);

  const { notifySent } = live;
  const appendSent = useCallback(
    (created: CommunityChatMessage) => {
      setMessages((prev) =>
        prev.some((m) => m.id === created.id)
          ? prev.map((m) => (m.id === created.id ? created : m))
          : [...prev, created]
      );
      notifySent(created.id);
    },
    [notifySent]
  );

  const toggleMute = async () => {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      setMuted(await setRoomMuted(channelId, !muted));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change alerts for this chat.');
    } finally {
      setMuteBusy(false);
    }
  };
  const voice = useVoiceRecorder({ channelId, onSent: appendSent, onError: setError });

  const focusComposer = () => window.setTimeout(() => draftRef.current?.focus(), 50);

  const startReply = (m: CommunityChatMessage) => {
    setEditing(null);
    setReplyTo(m);
    focusComposer();
  };

  const startEdit = (m: CommunityChatMessage) => {
    setReplyTo(null);
    setEditing(m);
    setDraft(m.content);
    focusComposer();
  };

  const cancelCompose = () => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyTo(null);
  };

  const onToggleReaction = async (m: CommunityChatMessage, emoji: string) => {
    if (!selfId || m.isDeleted) return;
    const before = m.reactions;
    const { next, on } = toggleReaction(m.reactions, emoji, selfId);
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: next } : x)));
    try {
      await setReaction(m.id, emoji, on);
    } catch (err) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: before } : x)));
      setError(err instanceof Error ? err.message : 'Could not react. Please try again.');
    }
  };

  const onDelete = async (m: CommunityChatMessage) => {
    try {
      await removeChatMessage(m.id);
      setMessages((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, isDeleted: true, content: '', attachments: [], reactions: [] } : x))
      );
      if (editing?.id === m.id) cancelCompose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that message.');
    }
  };

  const jumpTo = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((h) => (h === messageId ? null : h)), 1600);
  };

  // @mention suggestions while typing "@an…"
  useEffect(() => {
    if (!mentionQuery || isDm) {
      setMentionPeople([]);
      return;
    }
    let alive = true;
    const q = mentionQuery.query.toLowerCase();
    // Room leaders can notify everyone (even people who muted the group).
    const everyoneEntry: ChatMentionPerson[] =
      canPin && ('everyone'.startsWith(q) || 'all'.startsWith(q))
        ? [{ id: 'everyone', name: 'everyone', everyone: true, label: 'Notify everyone in this group' }]
        : [];
    const t = window.setTimeout(() => {
      searchRoomMentions(channelId, mentionQuery.query)
        .then((people) => {
          if (!alive) return;
          setMentionPeople([...everyoneEntry, ...rankByRecentActivity(people, recentAuthorsRef.current).slice(0, 8)]);
        })
        .catch(() => alive && setMentionPeople(everyoneEntry));
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [canPin, channelId, isDm, mentionQuery]);

  const pickMention = (person: ChatMentionPerson) => {
    if (!mentionQuery) return;
    const handle = person.everyone ? 'everyone' : mentionHandle(person.name);
    const caret = draftRef.current?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, mentionQuery.start)}@${handle} ${draft.slice(caret)}`;
    if (!person.everyone) mentionPicked.current.set(handle, person.id);
    setDraft(next);
    setMentionQuery(null);
    setMentionPeople([]);
    const pos = mentionQuery.start + handle.length + 2;
    window.setTimeout(() => {
      draftRef.current?.focus();
      draftRef.current?.setSelectionRange(pos, pos);
    }, 0);
  };

  const isLeader = CHAT_LEADER_ROLES.has(String(identity?.role || '').toUpperCase());

  useEffect(() => {
    if (!pendingJump || !messages.length) return;
    if (messages.some((m) => m.id === pendingJump)) {
      const id = pendingJump;
      setPendingJump(null);
      window.setTimeout(() => jumpTo(id), 150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, pendingJump]);

  // Search inside this room
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchHits(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      searchChatMessages(q, channelId)
        .then((hits) => alive && setSearchHits(hits))
        .catch(() => alive && setSearchHits([]));
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [channelId, searchOpen, searchQ]);

  const togglePin = async (m: CommunityChatMessage) => {
    const isPinned = pins.some((p) => p.id === m.id);
    try {
      setPins(await setPinned(m.id, !isPinned));
      setPinIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pin that message.');
    }
  };

  const currentPin = pins.length ? pins[Math.min(pinIndex, pins.length - 1)] : null;

  const openHuddle = (mode: 'join' | 'start') => {
    setHuddleMode(mode);
    setHuddleOpen(true);
    setHuddleIntent(null);
  };

  if (!validChannel) {
    return (
      <main className="flex-1 px-5 pt-10 pb-28">
        <Link
          to="/community/chat"
          className="inline-flex items-center gap-2 text-burgundy text-sm font-bold min-h-[44px]"
        >
          <ArrowLeft size={18} aria-hidden />
          Channels
        </Link>
        <p className="mt-6 text-sm text-burgundy">That channel link is not valid.</p>
      </main>
    );
  }

  return (
    <main className="flex-1 px-5 lg:px-8 pt-8 lg:pt-6 pb-2 flex flex-col min-h-[70vh] lg:min-h-0">
      <div className="flex items-center justify-between gap-2 mb-4">
        <Link
          to="/community/chat"
          className="inline-flex items-center gap-2 text-burgundy text-sm font-bold min-h-[44px] lg:invisible"
        >
          <ArrowLeft size={18} aria-hidden />
          Channels
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setSearchOpen((v) => !v);
              setSearchQ('');
              setSearchHits(null);
            }}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-burgundy rounded-xl"
            aria-label="Search this chat"
            aria-expanded={searchOpen}
          >
            <Search size={18} />
          </button>
          {openRequests.length ? (
            <button
              type="button"
              onClick={() => setRequestsOpen(true)}
              className="relative min-h-[44px] min-w-[44px] flex items-center justify-center text-burgundy rounded-xl"
              aria-label={`Open requests: ${openRequests.length}`}
            >
              <ClipboardList size={19} />
              <span className="absolute top-1 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-burgundy text-white text-[11px] font-black leading-[18px] text-center">
                {openRequests.length}
              </span>
            </button>
          ) : null}
          {!isDm ? (
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-burgundy rounded-xl"
              aria-label="Group info"
            >
              <Info size={18} />
            </button>
          ) : null}
          {!isDm && !huddleLive && !huddleOpen && mayStart ? (
            <button
              type="button"
              onClick={() => openHuddle('start')}
              className="inline-flex items-center gap-1.5 text-burgundy text-sm font-bold min-h-[44px] px-2"
            >
              <Radio size={16} aria-hidden />
              Start huddle
            </button>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              if (archiving) return;
              setArchiving(true);
              try {
                await setChatArchived(channelId, true);
                navigate('/community/chat', { replace: true, state: { archived: roomTitle } });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not archive this chat.');
                setArchiving(false);
              }
            }}
            disabled={archiving}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-burgundy rounded-xl disabled:opacity-50"
            aria-label="Archive this chat"
            title="Archive this chat (it comes back when someone posts)"
          >
            <Archive size={18} />
          </button>
          <button
            type="button"
            onClick={() => void toggleMute()}
            disabled={muteBusy}
            className={`inline-flex items-center gap-1.5 text-sm font-bold min-h-[44px] px-2 rounded-xl ${
              muted ? 'text-gray-500' : 'text-burgundy'
            }`}
            aria-pressed={muted}
            aria-label={muted ? 'Alerts muted for this chat. Tap to unmute.' : 'Mute alerts for this chat'}
            title={muted ? 'Unmute alerts' : 'Mute alerts'}
          >
            {muted ? <BellOff size={18} aria-hidden /> : <Bell size={18} aria-hidden />}
            <span className="hidden sm:inline">{muted ? 'Muted' : 'Mute'}</span>
          </button>
        </div>
      </div>

      {isPrayerWatchRoom ? (
        <a
          href={PRAYER_WATCH_URL}
          className="mb-3 flex items-center justify-center gap-2 min-h-[44px] rounded-2xl bg-gold/20 border border-gold text-sm font-bold text-[#1A1A1A]"
        >
          Open the Intercessors Prayer Watch
        </a>
      ) : null}

      <h1 className="text-lg font-bold text-[#1A1A1A] mb-3 truncate flex items-center gap-2">
        {announceOnly ? <Megaphone size={18} className="text-gold-ink shrink-0" aria-label="Announcements" /> : null}
        {roomTitle}
        {huddleLive && !isDm ? (
          <span
            className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
            role="status"
            aria-label="Live huddle"
          />
        ) : null}
      </h1>

      {searchOpen ? (
        <div className="mb-3 rounded-2xl bg-white border border-gray-200 shadow-sm p-3">
          <label className="relative block">
            <span className="sr-only">Search this chat</span>
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              autoFocus
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search messages in this chat…"
              className="w-full min-h-[48px] rounded-xl border border-gray-200 pl-10 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
            />
          </label>
          {searchHits !== null ? (
            searchHits.length ? (
              <ul className="mt-2 max-h-72 overflow-y-auto divide-y divide-gray-100">
                {searchHits.map((h) => {
                  const loaded = messages.some((m) => m.id === h.id);
                  return (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (loaded) {
                            setSearchOpen(false);
                            jumpTo(h.id);
                          }
                        }}
                        className="w-full text-left px-2 py-3 hover:bg-gray-50 active:bg-gray-50"
                      >
                        <span className="block text-xs font-bold text-burgundy">
                          {h.authorName}
                          {h.createdAt ? ` · ${new Date(h.createdAt).toLocaleDateString()}` : ''}
                          {!loaded ? ' · older message' : ''}
                        </span>
                        <span className="block text-sm text-[#1A1A1A] line-clamp-2">{h.content}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 mt-2 px-1">No messages found.</p>
            )
          ) : null}
        </div>
      ) : null}

      {currentPin ? (
        <div className="sticky top-0 z-[5] mb-3 flex items-stretch gap-2 rounded-2xl bg-white border border-gold/50 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => {
              if (messages.some((m) => m.id === currentPin.id)) jumpTo(currentPin.id);
              if (pins.length > 1) setPinIndex((i) => (i + 1) % pins.length);
            }}
            className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2 text-left"
            aria-label={`Pinned message from ${currentPin.authorName}. Tap to see it.`}
          >
            <Pin size={18} className="text-gold-ink shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-gold-ink">
                Pinned{pins.length > 1 ? ` · ${Math.min(pinIndex, pins.length - 1) + 1} of ${pins.length}` : ''}
              </span>
              <span className="block text-sm text-[#1A1A1A] truncate">{currentPin.content || '📎 Attachment'}</span>
            </span>
          </button>
        </div>
      ) : null}

      {showNotStarted ? (
        <div
          className="mb-4 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-semibold text-[#1A1A1A]"
          role="status"
        >
          {HUDDLE_NOT_STARTED_TEXT}
        </div>
      ) : null}

      {huddleIntent && !huddleOpen && !isDm && (huddleLive || huddleIntent === 'join' || mayStart) ? (
        <div className="mb-4 rounded-2xl bg-wine p-4 text-cream shadow-lg">
          <p className="text-sm font-semibold text-cream/85">
            {huddleLive || huddleIntent === 'join'
              ? 'A Live Huddle is running in this channel.'
              : 'Start a Live Huddle here. Others in this channel can join from Home.'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => openHuddle(huddleLive || huddleIntent === 'join' ? 'join' : 'start')}
              className="min-h-[48px] rounded-xl bg-leaf text-wine text-sm font-extrabold inline-flex items-center justify-center gap-1.5"
            >
              <Radio size={16} aria-hidden />
              {huddleLive || huddleIntent === 'join' ? 'Join huddle' : 'Start huddle'}
            </button>
            <button
              type="button"
              onClick={() => setHuddleIntent(null)}
              className="min-h-[48px] rounded-xl border border-cream/40 text-sm font-bold"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {huddleLive && !huddleOpen && !isDm ? (
        <div className="sticky top-0 z-20 mb-4 -mx-1 px-1">
          <button
            type="button"
            onClick={() => openHuddle('join')}
            className="w-full flex items-center justify-between gap-3 rounded-2xl bg-burgundy text-white px-4 py-3 shadow-lg min-h-[52px]"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Radio size={18} className="text-gold shrink-0" aria-hidden />
              <span className="text-left min-w-0">
                <span className="block text-xs font-black uppercase tracking-widest text-gold-ink">
                  Live now
                </span>
                <span className="block text-sm font-bold truncate">
                  Join huddle
                  {huddleCount > 0 ? ` · ${huddleCount} in room` : ''}
                </span>
              </span>
            </span>
            <span className="shrink-0 inline-flex items-center gap-1 rounded-md bg-emerald-500 text-white text-xs font-black uppercase tracking-wider px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden />
              Live
            </span>
          </button>
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
            <Loader2 className="animate-spin" size={18} aria-hidden />
            Loading messages…
          </div>
        ) : error && messages.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
            <p className="text-sm text-burgundy font-medium">{error}</p>
            <Button type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-12">
            No messages yet. Say hello to get started.
          </p>
        ) : (
          messages.map((msg) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              selfId={selfId}
              isDm={isDm}
              readers={readers}
              highlighted={highlightId === msg.id}
              onReply={startReply}
              onOpenActions={setActionsFor}
              onToggleReaction={(m, e) => void onToggleReaction(m, e)}
              onJumpTo={jumpTo}
              poll={polls[msg.id] || null}
              onPollVote={onPollVote}
              onPollClose={onPollClose}
              canCloseAnyPoll={isLeader}
              card={cards[msg.id] || null}
              onCardGoing={onCardGoing}
              onCardServe={onCardServe}
              request={requests[msg.id] || null}
              onRequestAction={onRequestAction}
            />
          ))
        )}
        <TypingBubble typers={live.typers} label={live.typingText} isDm={isDm} />
        <div ref={bottomRef} />
      </div>

      {/* Screen readers still hear "Ann is typing…" */}
      <p className="sr-only" aria-live="polite">
        {live.typingText}
      </p>

      {error && messages.length > 0 ? (
        <p className="text-xs text-burgundy mb-2">{error}</p>
      ) : null}

      {!canPost ? (
        <div className="sticky bottom-0 z-10 bg-eggshell/95 backdrop-blur-sm py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="rounded-2xl bg-white border border-gray-200 px-4 py-3 text-sm text-gray-600 text-center flex items-center justify-center gap-2">
            <Megaphone size={16} className="text-gold-ink" aria-hidden />
            Only leaders can send messages here. You can still react 🙏
          </p>
        </div>
      ) : (
      <div className="sticky bottom-0 z-10 bg-eggshell/95 backdrop-blur-sm pt-1">
      {mentionQuery && mentionPeople.length ? (
        <ul
          className="mb-2 rounded-2xl bg-white border border-gray-200 shadow-lg overflow-hidden"
          role="listbox"
          aria-label="Mention someone"
          style={{ maxHeight: '19rem', overflowY: 'auto' }}
        >
          {mentionPeople.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(p)}
                className="w-full min-h-[52px] px-3 flex items-center gap-3 text-left active:bg-gold/20 hover:bg-gray-50"
              >
                <span
                  className={`h-9 w-9 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${
                    p.everyone ? 'bg-gold/30 text-gold-ink' : 'bg-burgundy/10 text-burgundy'
                  }`}
                  aria-hidden
                >
                  {p.everyone ? <Megaphone size={16} /> : initialsOf(p.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#1A1A1A] truncate">
                    {p.everyone ? '@everyone' : p.name}
                  </span>
                  {p.label ? <span className="block text-xs text-gray-500 truncate">{p.label}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {replyTo || editing ? (
        <div className="mb-1 flex items-center gap-3 rounded-2xl bg-white border-l-4 border-burgundy border-y border-r border-gray-100 px-3 py-2">
          {editing ? (
            <Pencil size={18} className="text-burgundy shrink-0" aria-hidden />
          ) : (
            <CornerUpLeft size={18} className="text-burgundy shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-burgundy">
              {editing ? 'Editing your message' : `Replying to ${replyTo?.author.id === selfId ? 'yourself' : replyTo?.author.name}`}
            </p>
            {!editing && replyTo ? (
              <p className="text-sm text-gray-600 truncate">
                {replyTo.content || (replyTo.attachments?.length ? '📎 Attachment' : '')}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={cancelCompose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500"
            aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
          >
            <X size={18} />
          </button>
        </div>
      ) : null}

      <form
        className="pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        {!isDm && !huddleOpen && (huddleLive || mayStart) ? (
          <button
            type="button"
            onClick={() => openHuddle(huddleLive ? 'join' : 'start')}
            className={`relative min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center ${
              huddleLive ? 'bg-emerald-600 text-white' : 'bg-gold/25 text-burgundy'
            }`}
            aria-label={huddleLive ? 'Join live huddle' : 'Start a live huddle'}
            data-chat-huddle-button="true"
          >
            <Radio size={20} aria-hidden />
            {huddleLive ? (
              <span
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-white animate-pulse"
                aria-hidden
              />
            ) : null}
          </button>
        ) : null}
        {voice.recording ? (
          <VoiceRecordingBar seconds={voice.seconds} onCancel={voice.cancel} onSend={voice.send} />
        ) : (
          <>
        <ChatAttachButton
          channelId={channelId}
          disabled={sending || voice.sending}
          onSent={appendSent}
          onError={setError}
          onPoll={() => setPollComposerOpen(true)}
          onShareCard={() => setCardPickerOpen(true)}
          onRequest={() => setRequestComposerOpen(true)}
        />
        <label className="sr-only" htmlFor="chat-draft">
          Message
        </label>
        <textarea
          ref={draftRef}
          id="chat-draft"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) live.notifyTyping();
            setMentionQuery(isDm ? null : activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && mentionQuery) {
              setMentionQuery(null);
              return;
            }
            if (e.key === 'Escape' && (replyTo || editing)) cancelCompose();
            // Desktop: Enter sends, Shift+Enter adds a line. Phones keep Enter for new lines.
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia?.('(min-width: 1024px)').matches) {
              e.preventDefault();
              if (mentionPeople.length && mentionQuery) pickMention(mentionPeople[0]);
              else void onSend();
            }
          }}
          rows={2}
          placeholder={editing ? 'Edit your message…' : 'Write a message…'}
          className="flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-burgundy/30"
          maxLength={4000}
          disabled={sending}
        />
        {!draft.trim() && !sending && voice.supported ? (
          <MicButton onClick={() => void voice.start()} busy={voice.sending} />
        ) : (
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="min-h-[48px] min-w-[48px] rounded-2xl bg-burgundy text-white flex items-center justify-center disabled:opacity-40"
          aria-label="Send message"
        >
          {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
        </button>
        )}
          </>
        )}
      </form>
      </div>
      )}

      {infoOpen ? (
        <GroupInfoSheet
          channelId={channelId}
          name={roomTitle}
          description={roomDescription}
          visibility={roomVisibility}
          announceOnly={announceOnly}
          canManage={canManage}
          selfId={selfId}
          onClose={() => setInfoOpen(false)}
          onChanged={(patch) => {
            if (patch.name) setVaultRoomName(patch.name);
            if (patch.description !== undefined) setRoomDescription(patch.description);
            if (patch.announceOnly !== undefined) setAnnounceOnly(patch.announceOnly);
          }}
        />
      ) : null}

      {actionsFor ? (
        <MessageActions
          message={actionsFor}
          selfId={selfId}
          canEdit={canEditMessage(actionsFor, selfId) && !polls[actionsFor.id] && !cards[actionsFor.id] && !requests[actionsFor.id] && !String(actionsFor.content || '').startsWith(REQUEST_PREFIX) && !String(actionsFor.content || '').startsWith(POLL_MESSAGE_PREFIX) && !isCardMessageText(actionsFor.content)}
          canDelete={actionsFor.author.id === selfId || isLeader}
          canPin={canPin}
          isPinned={pins.some((p) => p.id === actionsFor.id)}
          onTogglePin={() => void togglePin(actionsFor)}
          onClose={() => setActionsFor(null)}
          onReact={(e) => void onToggleReaction(actionsFor, e)}
          onReply={() => startReply(actionsFor)}
          onEdit={() => startEdit(actionsFor)}
          onDelete={() => onDelete(actionsFor)}
          onReport={(reason, note) => reportChatMessage(actionsFor.id, reason, note)}
        />
      ) : null}

      {requestComposerOpen ? (
        <RequestComposerSheet
          onCancel={() => setRequestComposerOpen(false)}
          onCreate={async (input) => {
            const { message, request } = await createRequest(channelId, input);
            setRequests((prev) => ({ ...prev, [message.id]: request }));
            setOpenRequests((prev) => [request, ...prev]);
            appendSent(message);
            setRequestComposerOpen(false);
            setError(null);
          }}
        />
      ) : null}

      {requestsOpen ? (
        <Portal>
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={() => setRequestsOpen(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="open-requests-title"
              className="w-full max-w-[500px] max-h-[88vh] flex flex-col rounded-t-3xl lg:rounded-3xl bg-eggshell shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] gap-3"
            >
              <div className="flex items-center justify-between px-1">
                <h2 id="open-requests-title" className="flex items-center gap-2 text-xl font-bold text-[#1A1A1A]">
                  <ClipboardList size={22} className="text-burgundy" aria-hidden /> Open requests
                </h2>
                <button
                  type="button"
                  onClick={() => setRequestsOpen(false)}
                  className="min-h-[44px] min-w-[44px] rounded-full bg-white text-gray-700 flex items-center justify-center"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3">
                {openRequests.length ? (
                  openRequests.map((r) => (
                    <div key={r.id} className="space-y-1">
                      <RequestCard request={requests[r.messageId] || r} onAction={onRequestAction} />
                      <button
                        type="button"
                        onClick={() => {
                          setRequestsOpen(false);
                          jumpTo(r.messageId);
                        }}
                        className="text-xs font-bold text-burgundy underline underline-offset-2 px-1 min-h-[32px]"
                      >
                        Show in chat
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 text-center py-8">No open requests. 🙏</p>
                )}
              </div>
            </div>
          </div>
        </Portal>
      ) : null}

      {cardPickerOpen ? (
        <CardPickerSheet
          onCancel={() => setCardPickerOpen(false)}
          onShare={async (pick) => {
            const message = await shareCard(channelId, pick.kind, pick.id, pick.title, pick.note);
            appendSent(message);
            setCardPickerOpen(false);
            const fresh = await fetchCards([message.id]).catch(() => []);
            if (fresh[0]) setCards((prev) => ({ ...prev, [message.id]: fresh[0] }));
            setError(null);
          }}
        />
      ) : null}

      {pollComposerOpen ? (
        <PollComposerSheet
          onCancel={() => setPollComposerOpen(false)}
          onCreate={async (input) => {
            const { message, poll } = await createPoll(channelId, input);
            setPolls((prev) => ({ ...prev, [message.id]: poll }));
            appendSent(message);
            setPollComposerOpen(false);
            setError(null);
          }}
        />
      ) : null}

      {huddleOpen ? (
        <ConnectVoiceHuddle
          channelId={channelId}
          channelName={roomTitle}
          audioOnly={isPrayerWatchRoom}
          mode={huddleMode}
          onClose={() => {
            setHuddleOpen(false);
            void loadHuddle();
          }}
        />
      ) : null}
    </main>
  );
};
