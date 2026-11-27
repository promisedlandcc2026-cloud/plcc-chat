import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronsLeft,
  Ban,
  Flag,
  Church,
  HandHeart,
  Lock,
  MoonStar,
  Radio,
  Sun,
  Sunrise,
  Loader2,
  Megaphone,
  Users,
  BookOpen,
  ChevronRight,
  Hash,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHuddleLive } from '../context/HuddleLiveContext';
import {
  CommunityChatError,
  isDmChannel,
  isHuddleChannelLive,
  type ChatDirectoryMember,
  type CommunityChatChannel,
} from '../lib/communityChatTypes';
import {
  fetchChatChannels,
  fetchChatUnread,
  openDirectMessage,
  searchChatDirectory,
} from '../lib/communityChatClient';
import { dmDisplayName, forgetDmRecent, listDmRecents, rememberDmRecent, replaceDmRecents } from '../lib/dmRecents';
import { SwipeToDelete } from '../components/chat/SwipeToDelete';
import { DmBlockSheet, DmReportSheet } from '../components/chat/DmSafetySheets';
import {
  dismissSwipeTip,
  hasDismissedSwipeTip,
  hasSeenSwipePeek,
  isTouchDevice,
  markSwipePeekSeen,
} from '../lib/dmSwipeHint';
import { Button } from '../components/ui/Button';
import { AccountMenu } from '../components/chat/AccountMenu';
import { BackToAwcOne } from '../components/ui/BackToAwcOne';
import { NewGroupSheet } from '../components/chat/NewGroupSheet';
import { CHAT_LEADER_ROLES } from '../lib/chatRoles';
import {
  deleteDmChat,
  fetchArchivedChatIds,
  fetchDmList,
  searchChatMessages,
  setChatArchived,
  setDmBlocked,
} from '../lib/communityChatClient';
import { Portal } from '../components/chat/Portal';
import type { ChatSearchHit } from '../lib/communityChatTypes';
import { ChatNavTabs } from '../components/chat/ChatNavTabs';
import {
  resolveChatHomeTab,
  readStoredChatHomeTab,
  storeChatHomeTab,
  type ChatHomeTab,
} from '../lib/chatHomeTabs';
import {
  matchPrayerGatherings,
  prayerGatheringRoomIds,
  PRAYER_GATHERINGS,
  type PrayerGatheringKey,
} from '../lib/prayerGatherings';
import { huddleRoomPath, liveHuddleRows } from '../lib/liveHuddles';
import { fetchIntercessorsAccess } from '../lib/intercessorsClient';
import { useActiveKaLink } from '../context/ActiveKaLinkContext';
import { refreshEmergencyPasses } from '../lib/emergencyEntry';
import { readSavedPrayerRooms } from '../lib/outageCache';

const GATHERING_ICONS: Record<PrayerGatheringKey, React.ReactNode> = {
  'morning-glory': <Sunrise size={22} aria-hidden />,
  'lunch-hour': <Sun size={22} aria-hidden />,
  'midnight-watch': <MoonStar size={22} aria-hidden />,
  'upper-room': <Church size={22} aria-hidden />,
  intercessors: <HandHeart size={22} aria-hidden />,
};

const SEARCH_DEBOUNCE_MS = 280;

/** Small green "Live ·" lead-in for a row's second line. */
const LiveMark: React.FC = () => (
  <span className="kl-live-mark">
    <span className="kl-live-dot" aria-hidden />
    Live ·{' '}
  </span>
);

const TAB_TITLES: Record<ChatHomeTab, string> = {
  prayer: 'Prayer Gatherings',
  ministries: 'Ministry Channels',
  messages: 'Messages',
  huddles: 'Live Ka Links',
};

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function firstName(name: string | null | undefined): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function initialsOf(name: string): string {
  const parts = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const AVATAR_TINTS = ['#1f5b40', '#7a5a1e', '#2f4f6b', '#6b3a3a', '#46602a', '#5a3f6b', '#2d6363'];
function avatarTint(name: string): string {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

/** "14:05" today, "Mon" this week, otherwise "24 Nov". */
function shortWhen(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = (now.getTime() - t.getTime()) / 864e5;
  if (days < 6) return t.toLocaleDateString([], { weekday: 'short' });
  return t.toLocaleDateString([], { day: 'numeric', month: 'short' });
}


function visibilityLabel(visibility: string | null): string {
  const v = String(visibility || '').toLowerCase();
  if (v === 'dm') return 'Direct';
  if (v === 'open' || v === 'public') return 'Open';
  if (v === 'ministry') return 'Ministry';
  if (v === 'leadership') return 'Leadership';
  if (v === 'private') return 'Private';
  if (v === 'event') return 'Event';
  return 'Channel';
}

export const CommunityChatPage: React.FC = () => {
  /** Desktop: the conversation open on the right, highlighted in the list. */
  const { channelId: activeChannelId } = useParams();
  const { identity: me, user: authUser } = useAuth();
  /** Whose DMs this list shows. */
  const ownerId = me?.id || authUser?.id || '';
  const canCreateGroups = CHAT_LEADER_ROLES.has(String(me?.role || '').toUpperCase());
  const { identity, memberAccessState } = useAuth();
  const navigate = useNavigate();
  const [channels, setChannels] = useState<CommunityChatChannel[]>([]);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  /** Last message + time per direct chat, for the list preview. */
  const [dmPreview, setDmPreview] = useState<Record<string, { text: string | null; at: string | null }>>({});
  const { byChannel: huddleByChannel } = useHuddleLive();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { openKaLink } = useActiveKaLink();
  // Server trouble: the prayer rooms this phone saved, so members can still join.
  const emergencyRooms = useMemo(() => (error && ownerId ? readSavedPrayerRooms(ownerId) : []), [error, ownerId]);
  // Filled per account once we know who is signed in (never another account's DMs).
  const [dmRecents, setDmRecents] = useState<ReturnType<typeof listDmRecents>>([]);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  /** Chats you archived (hidden at the bottom until someone posts again). */
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ id: string; title: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Which DM row is swiped open, and which one is waiting on "Delete chat?". */
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** DMs where you blocked the other person. */
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [confirmBlock, setConfirmBlock] = useState<{ id: string; title: string } | null>(null);
  const [reportFor, setReportFor] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** First-time hints that chats can be swiped left to delete. */
  const [touch] = useState(isTouchDevice);
  const [peekPending, setPeekPending] = useState(() => !hasSeenSwipePeek());
  const [showSwipeTip, setShowSwipeTip] = useState(() => !hasDismissedSwipeTip());
  const hideSwipeTip = () => {
    dismissSwipeTip();
    setShowSwipeTip(false);
  };
  const longPress = React.useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const location = useLocation();
  /** Search messages across every room you're in. */
  const [msgQ, setMsgQ] = useState('');
  const [msgHits, setMsgHits] = useState<ChatSearchHit[] | null>(null);
  const [msgSearching, setMsgSearching] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<ChatDirectoryMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [openingPartnerId, setOpeningPartnerId] = useState<string | null>(null);
  /** An open DM selects Messages; otherwise use the URL or this visit’s last tab. */
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const openDm = Boolean(activeChannelId && ((location.state as {isDm?:boolean}|null)?.isDm || dmRecents.some(dm=>dm.channelId===activeChannelId) || channels.some(channel=>channel.id===activeChannelId && isDmChannel(channel))));
  const activeTab: ChatHomeTab = resolveChatHomeTab(urlTab, readStoredChatHomeTab(), openDm);
  const setActiveTab = (tab: ChatHomeTab) => {
    storeChatHomeTab(tab);
    if (activeChannelId) { navigate(`/community/chat?tab=${tab}`); return; }
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };
  /** The Vault's Intercessor room id, when this member is on the Intercessors team. */
  const [intercessors, setIntercessors] = useState<{ allowed: boolean; roomId: string | null } | null>(null);

  const load = useCallback(async () => {
    if (memberAccessState !== 'approved_member') return;
    setLoading(true);
    setError(null);
    try {
      const [list, unread, dms, archived] = await Promise.all([
        fetchChatChannels(),
        fetchChatUnread().catch(() => ({ count: 0, byChannel: {} })),
        fetchDmList(),
        fetchArchivedChatIds(),
      ]);
      if (archived) setArchivedIds(archived);
      setChannels(list);
      setUnreadByChannel(unread.byChannel);
      if (dms) setBlockedIds(new Set(dms.filter((d) => d.blocked).map((d) => d.channelId)));
      if (dms) setDmPreview(Object.fromEntries(dms.map((d) => [d.channelId, { text: d.lastMessage, at: d.lastMessageAt }])));
      if (dms && ownerId) {
        // The Vault's list wins; keep this device's copy in step for room titles.
        replaceDmRecents(
          ownerId,
          dms.map((d) => ({
            channelId: d.channelId,
            partnerId: d.partnerId,
            partnerName: d.partnerName,
            avatarUrl: null,
            updatedAt: d.lastMessageAt ? Date.parse(d.lastMessageAt) : 0,
          }))
        );
      }
      setDmRecents(listDmRecents(ownerId));
      // While Canaan is healthy, keep emergency passes for the prayer rooms fresh.
      void refreshEmergencyPasses(ownerId);
    } catch (err) {
      const message =
        err instanceof CommunityChatError
          ? err.message
          : 'Chat is temporarily unavailable. Please try again.';
      setError(message);
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [memberAccessState, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (memberAccessState !== 'approved_member') return;
    let alive = true;
    fetchIntercessorsAccess()
      .then((a) => alive && setIntercessors({ allowed: a.allowed, roomId: a.allowed ? a.roomId : null }))
      .catch(() => alive && setIntercessors({ allowed: false, roomId: null }));
    return () => {
      alive = false;
    };
  }, [memberAccessState]);

  useEffect(() => {
    if (!newChatOpen) return;
    const q = searchQ.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void searchChatDirectory(q, { signal: controller.signal })
        .then((members) => {
          if (!controller.signal.aborted) setSearchResults(members);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setSearchResults([]);
          setSearchError(
            err instanceof CommunityChatError
              ? err.message
              : 'Could not search members. Please try again.'
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [newChatOpen, searchQ]);

  const groupChannels = useMemo(
    () => channels.filter((c) => !isDmChannel(c)),
    [channels]
  );
  const gatherings = useMemo(
    () => matchPrayerGatherings(groupChannels, intercessors?.roomId ?? null),
    [groupChannels, intercessors]
  );
  const gatheringIds = useMemo(() => prayerGatheringRoomIds(gatherings), [gatherings]);
  const activeGroups = groupChannels.filter((c) => !archivedIds.has(c.id) && !gatheringIds.has(c.id));
  const liveRows = useMemo(() => liveHuddleRows(groupChannels, huddleByChannel), [groupChannels, huddleByChannel]);
  const unreadOf = (id: string) => (activeChannelId === id ? 0 : unreadByChannel[id] || 0);
  const prayerUnread = [...gatheringIds].reduce((n, id) => n + unreadOf(id), 0);
  const ministryUnread = activeGroups.reduce((n, c) => n + unreadOf(c.id), 0);
  const archivedGroups = groupChannels.filter((c) => archivedIds.has(c.id));
  const activeDms = dmRecents.filter((d) => !archivedIds.has(d.channelId));
  const archivedDms = dmRecents.filter((d) => archivedIds.has(d.channelId));
  /** Archived chats for the tab that's showing (DMs on Messages, rooms on Ministries). */
  const archivedCount = activeTab === 'messages' ? archivedDms.length : activeTab === 'ministries' ? archivedGroups.length : 0;
  const messageUnread = activeDms.reduce((n, d) => n + unreadOf(d.channelId), 0);

  const closeNewChat = () => {
    setNewChatOpen(false);
    setSearchQ('');
    setSearchResults([]);
    setSearchError(null);
    setOpeningPartnerId(null);
  };

  const startDm = async (partner: ChatDirectoryMember) => {
    if (openingPartnerId) return;
    setOpeningPartnerId(partner.id);
    setSearchError(null);
    try {
      const { channel } = await openDirectMessage(partner.id);
      rememberDmRecent({ ownerId, channelId: channel.id, partner });
      setDmRecents(listDmRecents(ownerId));
      closeNewChat();
      navigate(`/community/chat/${channel.id}?tab=messages`, {
        state: { partnerName: partner.name, isDm: true },
      });
    } catch (err) {
      setSearchError(
        err instanceof CommunityChatError
          ? err.message
          : 'Could not open that conversation. Please try again.'
      );
      setOpeningPartnerId(null);
    }
  };

  useEffect(() => {
    const q = msgQ.trim();
    if (q.length < 2) {
      setMsgHits(null);
      return;
    }
    let alive = true;
    setMsgSearching(true);
    const t = window.setTimeout(() => {
      searchChatMessages(q)
        .then((hits) => alive && setMsgHits(hits))
        .catch(() => alive && setMsgHits([]))
        .finally(() => alive && setMsgSearching(false));
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [msgQ]);

  useEffect(() => {
    const archivedTitle = (location.state as { archived?: string } | null)?.archived;
    if (!archivedTitle) return;
    setToast(`“${archivedTitle}” archived. It’s under Archived at the bottom and comes back when someone posts.`);
    navigate(location.pathname, { replace: true, state: null });
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const toggleArchive = async (id: string, archive: boolean) => {
    setRowMenu(null);
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (archive) next.add(id);
      else next.delete(id);
      return next;
    });
    try {
      await setChatArchived(id, archive);
    } catch (err) {
      setArchivedIds((prev) => {
        const next = new Set(prev);
        if (archive) next.delete(id);
        else next.add(id);
        return next;
      });
      setToast(err instanceof Error ? err.message : 'Could not change that chat.');
    }
  };

  const isDmId = (id: string) => dmRecents.some((d) => d.channelId === id);

  const deleteDm = async (id: string, title: string) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteDmChat(id);
      if (ownerId) forgetDmRecent(ownerId, id);
      setDmRecents((prev) => prev.filter((d) => d.channelId !== id));
      setArchivedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setConfirmDelete(null);
      if (activeChannelId === id) navigate('/community/chat?tab=messages', { replace: true });
      setToast(`Chat with ${title} deleted.`);
      window.setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setConfirmDelete(null);
      setToast(err instanceof Error ? err.message : 'Could not delete this chat.');
      window.setTimeout(() => setToast(null), 6000);
    } finally {
      setDeleting(false);
    }
  };

  const flash = (msg: string, ms = 4000) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  };
  const markBlocked = (id: string, on: boolean) =>
    setBlockedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const changeBlock = async (id: string, title: string, on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await setDmBlocked(id, on);
      markBlocked(id, on);
      setConfirmBlock(null);
      setRowMenu(null);
      flash(on ? `${title} is blocked. They can’t message you.` : `${title} is unblocked.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Something went wrong. Please try again.', 6000);
    } finally {
      setBusy(false);
    }
  };

  const openReport = (target: { id: string; title: string }) => {
    setRowMenu(null);
    setConfirmBlock(null);
    setReportFor(target);
  };

  const archiveFromSwipe = (id: string, title: string) => {
    const archive = !archivedIds.has(id);
    void toggleArchive(id, archive);
    flash(archive ? `${title} archived. It’s under Archived at the bottom.` : `${title} moved back to Messages.`);
  };

  const rowPressHandlers = (id: string, title: string) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setRowMenu({ id, title });
    },
    onTouchStart: () => {
      longPress.current.fired = false;
      longPress.current.timer = window.setTimeout(() => {
        longPress.current.fired = true;
        navigator.vibrate?.(15);
        setRowMenu({ id, title });
      }, 500);
    },
    onTouchMove: () => {
      if (longPress.current.timer) window.clearTimeout(longPress.current.timer);
    },
    onTouchEnd: () => {
      if (longPress.current.timer) window.clearTimeout(longPress.current.timer);
    },
    onClickCapture: (e: React.MouseEvent) => {
      // A press-and-hold opened the menu — don't also open the chat.
      if (longPress.current.fired) {
        e.preventDefault();
        e.stopPropagation();
        longPress.current.fired = false;
      }
    },
  });

  const renderChannelRow = (
    channel: CommunityChatChannel,
    title: string,
    opts?: { isDm?: boolean }
  ) => {
    const unread = activeChannelId === channel.id ? 0 : unreadByChannel[channel.id] || 0;
    const huddle = huddleByChannel[channel.id];
    const active = activeChannelId === channel.id;
    const live = isHuddleChannelLive(huddle) && !opts?.isDm;
    const preview = opts?.isDm ? dmPreview[channel.id] : undefined;
    const blocked = Boolean(opts?.isDm && blockedIds.has(channel.id));
    const meta = opts?.isDm
      ? blocked
        ? 'Blocked'
        : preview?.text || 'Direct message'
      : live && huddle?.participantCount
        ? `${huddle.participantCount} in Ka Link`
        : channel.description || visibilityLabel(channel.visibility);
    const row = (
        <Link
          to={`/community/chat/${channel.id}${opts?.isDm ? '?tab=messages' : activeTab === 'ministries' ? '?tab=ministries' : ''}`}
          state={{
            channelName: title,
            partnerName: opts?.isDm ? title : undefined,
            isDm: Boolean(opts?.isDm),
          }}
          aria-current={active ? 'page' : undefined}
          className={`kl-row chat-channel-row ${active ? 'kl-row-active' : ''}`}
        >
          {opts?.isDm ? (
            <span className="kl-avatar" style={{ background: avatarTint(title) }} aria-hidden>
              {initialsOf(title)}
            </span>
          ) : (
            <span className="kl-tile" aria-hidden>
              {channel.announceOnly ? <Megaphone size={18} /> : <Hash size={18} />}
            </span>
          )}
          <span className="min-w-0 flex-1 text-left">
            <span className="flex items-center gap-2 min-w-0">
              <span className="kl-row-title chat-channel-title" title={title}>{title}</span>
              {opts?.isDm && preview?.at ? <span className="kl-row-time">{shortWhen(preview.at)}</span> : null}
            </span>
            <span className={`kl-row-meta chat-channel-meta ${unread > 0 ? 'kl-row-meta-unread' : ''}`}>
              {live ? <LiveMark /> : null}
              {meta}
              {blocked ? <span className="sr-only"> · Blocked</span> : null}
            </span>
          </span>
          {unread > 0 ? (
            <span className="kl-count" aria-label={`${unread} unread`}>
              {unread > 99 ? '99+' : unread}
            </span>
          ) : live ? (
            <span className="kl-join">Join</span>
          ) : null}
        </Link>
    );
    return (
      <li key={channel.id} {...rowPressHandlers(channel.id, title)}>
        {opts?.isDm ? (
          <SwipeToDelete
            label={title}
            open={swipeOpenId === channel.id}
            onOpenChange={(o) => {
              setSwipeOpenId(o ? channel.id : swipeOpenId === channel.id ? null : swipeOpenId);
              if (o && showSwipeTip) hideSwipeTip(); // they found it
            }}
            peek={touch && peekPending && activeTab === 'messages' && activeDms[0]?.channelId === channel.id}
            onPeekDone={() => {
              markSwipePeekSeen();
              setPeekPending(false);
            }}
            onDelete={() => setConfirmDelete({ id: channel.id, title })}
            onArchive={() => archiveFromSwipe(channel.id, title)}
            archived={archivedIds.has(channel.id)}
          >
            {row}
          </SwipeToDelete>
        ) : (
          row
        )}
      </li>
    );
  };

  return (
    <main className="kl-home ka-link-chat-surface flex-1 lg:flex lg:min-h-full lg:flex-col">
      <header className="kl-header">
        <div className="flex items-center justify-between gap-3">
          <img
            src="/ka-link-gold-logo.png"
            alt="PLCC Ka Link"
            width={168}
            height={56}
            className="h-auto w-[124px] select-none object-contain"
            draggable={false}
          />
          <BackToAwcOne className="kl-one" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="kl-greeting">{greeting()}</p>
            <h1 className="kl-name" title={identity?.name || undefined}>{firstName(identity?.name) || 'Welcome'}</h1>
          </div>
          <div className="kl-account shrink-0"><AccountMenu /></div>
        </div>
        <label className="kl-search chat-global-search">
          <span className="sr-only">Search messages</span>
          <Search size={18} className="kl-search-icon" aria-hidden />
          <input
            value={msgQ}
            onChange={(e) => setMsgQ(e.target.value)}
            placeholder="Search all messages…"
            type="search"
          />
          {msgQ ? (
            <button type="button" onClick={() => setMsgQ('')} className="kl-search-clear" aria-label="Clear search">
              <X size={16} />
            </button>
          ) : null}
        </label>
      </header>

      <div className="kl-body lg:flex lg:flex-1 lg:flex-col">
      <ChatNavTabs
        active={activeTab}
        onChange={setActiveTab}
        prayerUnread={prayerUnread}
        ministryUnread={ministryUnread}
        messageUnread={messageUnread}
        liveCount={liveRows.length}
      />

      <div className="kl-toolbar chat-sidebar-actions">
        <h2 className="kl-section-title">{TAB_TITLES[activeTab]}</h2>
        <div className="flex items-center gap-1">
          {activeTab === 'ministries' && canCreateGroups ? (
            <button type="button" onClick={() => setNewGroupOpen(true)} className="kl-ghost-btn" aria-label="New group">
              <Users size={16} aria-hidden /> Group
            </button>
          ) : null}
          {activeTab === 'messages' ? (
            <button type="button" onClick={() => setNewChatOpen(true)} className="kl-primary-btn" aria-label="New chat">
              <Plus size={16} aria-hidden /> New message
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            className="kl-icon-btn"
            aria-label="Refresh chats"
            title="Refresh"
          >
            <RefreshCcw size={17} aria-hidden />
          </button>
        </div>
      </div>

      {msgQ.trim().length >= 2 ? (
        <section className="mb-6" aria-label="Search results">
          <h3 className="kl-eyebrow">Search results</h3>
          {msgHits === null || (msgSearching && !msgHits.length) ? (
            <p className="kl-empty flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Searching…
            </p>
          ) : msgHits.length ? (
            <ul className="kl-list">
              {msgHits.map((h) => (
                <li key={h.id}>
                  <Link
                    to={`/community/chat/${h.channelId}?m=${h.id}`}
                    state={{ channelName: h.channelName || undefined }}
                    className="kl-row items-start"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-[#8a6a22]">
                        {h.channelName || 'Chat'} · {h.authorName}
                        {h.createdAt ? ` · ${new Date(h.createdAt).toLocaleDateString()}` : ''}
                      </span>
                      <span className="mt-0.5 block text-sm text-[#14261c] line-clamp-2">{h.content}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="kl-empty">No messages found.</p>
          )}
        </section>
      ) : null}

      {newGroupOpen ? (
        <NewGroupSheet
          onClose={() => setNewGroupOpen(false)}
          onCreated={(channel) => {
            setNewGroupOpen(false);
            void load();
            navigate(`/community/chat/${channel.id}`, { state: { channelName: channel.name } });
          }}
        />
      ) : null}

      {loading ? (
        <ul className="kl-list" aria-label="Loading chats" role="status">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="kl-row kl-skeleton" aria-hidden>
              <span className="kl-tile" />
              <span className="flex-1 space-y-2">
                <span className="block h-3 w-2/5 rounded bg-[#e8e4da]" />
                <span className="block h-2.5 w-3/5 rounded bg-[#efece4]" />
              </span>
            </li>
          ))}
          <li className="sr-only">Loading channels…</li>
        </ul>
      ) : error ? (
        <div className="kl-card space-y-4">
          <p className="text-sm text-[#9b2c2c] font-medium">{error}</p>
          <Button type="button" onClick={() => void load()}>
            Try again
          </Button>
          {emergencyRooms.length > 0 ? (
            <div className="space-y-2 border-t border-[#e8e4da] pt-4" data-testid="emergency-prayer-rooms">
              <p className="text-sm font-semibold">You can still join a prayer room:</p>
              <ul className="space-y-2">
                {emergencyRooms.map((room) => (
                  <li key={room.channelId}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-[#d9d2c3] bg-white px-4 py-3 text-left font-semibold"
                      onClick={() => openKaLink({ channelId: room.channelId, channelName: room.name, mode: 'join' })}
                    >
                      <span>{room.name}</span>
                      <span className="text-sm text-[#1d5b33]">Join</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[#6b6455]">Chat and other features come back when the server does.</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          {toast ? (
            <p className="kl-toast" role="status">
              {toast}
            </p>
          ) : null}
          {activeTab === 'prayer' ? (
            <div role="tabpanel" id="chat-panel-prayer" aria-labelledby="chat-tab-prayer">
              <p className="kl-hint">Tap a gathering to open its room. <span className="kl-live-word">Live</span> means people are praying now.</p>
              <ul className="kl-list">
                {PRAYER_GATHERINGS.map((g) => {
                  const room = gatherings[g.key];
                  const huddle = room ? huddleByChannel[room.id] : undefined;
                  const live = room ? isHuddleChannelLive(huddle) : false;
                  const unread = room ? unreadOf(room.id) : 0;
                  const lockedIntercessors = g.key === 'intercessors' && !room && intercessors && !intercessors.allowed;
                  const body = (
                    <>
                      <span className={`kl-tile kl-tile-lg ${room ? 'kl-tile-gold' : 'kl-tile-muted'}`} aria-hidden>
                        {GATHERING_ICONS[g.key]}
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`kl-row-title ${room ? '' : 'text-[#7d877f]'}`}>{g.name}</span>
                        </span>
                        <span className="kl-row-meta">
                          {live ? <LiveMark /> : null}
                          {live && huddle?.participantCount
                            ? `${huddle.participantCount} praying now`
                            : room
                              ? g.blurb
                              : lockedIntercessors
                                ? 'For the Intercessors team.'
                                : 'This room is not open yet.'}
                        </span>
                      </span>
                      {unread > 0 ? (
                        <span className="kl-count" aria-label={`${unread} unread`}>
                          {unread > 99 ? '99+' : unread}
                        </span>
                      ) : null}
                      {lockedIntercessors ? <Lock size={16} className="text-[#9aa39c] shrink-0" aria-hidden /> : null}
                      {room && live ? (
                        <span className="kl-join">Join</span>
                      ) : room ? (
                        <ChevronRight size={18} className="kl-chevron" aria-hidden />
                      ) : null}
                    </>
                  );
                  return (
                    <li key={g.key}>
                      {room ? (
                        <Link
                          to={live ? huddleRoomPath(room.id, 'join') : `/community/chat/${room.id}`}
                          state={{ channelName: room.name }}
                          aria-current={activeChannelId === room.id ? 'page' : undefined}
                          data-prayer-gathering={g.key}
                          className={`kl-row kl-row-tall ${activeChannelId === room.id ? 'kl-row-active' : ''} ${live ? 'kl-row-live' : ''}`}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="kl-row kl-row-tall kl-row-disabled" data-prayer-gathering={g.key} aria-disabled="true">
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {activeTab === 'ministries' ? (
            <section role="tabpanel" id="chat-panel-ministries" aria-labelledby="chat-tab-ministries">
              {activeGroups.length === 0 ? (
                <div className="kl-card kl-empty">No ministry channels are available yet.</div>
              ) : (
                <ul className="kl-list">
                  {activeGroups.map((channel) =>
                    renderChannelRow(
                      channel,
                      isDmChannel(channel) ? dmDisplayName(channel.id, channel.name, ownerId) : channel.name
                    )
                  )}
                </ul>
              )}
            </section>
          ) : null}

          {activeTab === 'messages' ? (
            <section role="tabpanel" id="chat-panel-messages" aria-labelledby="chat-tab-messages">
              {activeDms.length === 0 ? (
                <div className="kl-card kl-empty">
                  No private messages yet. Tap <strong>New message</strong> to write to a member.
                </div>
              ) : (
                <>
                {showSwipeTip ? (
                  <div className="kl-tip">
                    <span className="text-[#8a6a22] shrink-0 inline-flex" aria-hidden>
                      <ChevronsLeft size={18} className="animate-pulse" />
                    </span>
                    <p className="flex-1 text-xs text-[#4b5a50] leading-snug">
                      {touch
                        ? 'Tip: swipe a chat left to archive or delete it. Press and hold to block or report.'
                        : 'Tip: right-click a chat to archive, delete, block or report.'}
                    </p>
                    <button type="button" onClick={hideSwipeTip} className="kl-tip-btn">
                      Got it
                    </button>
                  </div>
                ) : null}
                <ul className="kl-list">
                  {activeDms.map((dm) =>
                    renderChannelRow(
                      {
                        id: dm.channelId,
                        name: dm.partnerName,
                        description: null,
                        visibility: 'dm',
                        type: 'private',
                        ministryId: null,
                      },
                      dm.partnerName,
                      { isDm: true }
                    )
                  )}
                </ul>
                </>
              )}
            </section>
          ) : null}

          {activeTab === 'huddles' ? (
            <section role="tabpanel" id="chat-panel-huddles" aria-labelledby="chat-tab-huddles">
              {liveRows.length === 0 ? (
                <div className="kl-card kl-empty-state">
                  <span className="kl-tile kl-tile-lg kl-tile-muted mx-auto" aria-hidden><Radio size={22} /></span>
                  <p className="mt-3 font-semibold text-[#14261c]">No Live Ka Links right now.</p>
                  <p className="mt-1">Live prayer and ministry rooms appear here.</p>
                </div>
              ) : (
                <ul className="kl-list">
                  {liveRows.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={huddleRoomPath(row.id, 'join')}
                        state={{ channelName: row.name }}
                        className="kl-row kl-row-tall kl-row-live"
                      >
                        <span className="kl-tile kl-tile-lg kl-tile-live" aria-hidden>
                          <Radio size={20} />
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="kl-row-title">{row.name}</span>
                          </span>
                          <span className="kl-row-meta">
                            <LiveMark />
                            {row.count > 0 ? `${row.count} in Ka Link` : 'Open now'}
                          </span>
                        </span>
                        <span className="kl-join">Join</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {archivedCount > 0 ? (
            <section>
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="kl-archived-toggle"
                aria-expanded={showArchived}
              >
                <span className="inline-flex items-center gap-2">
                  <Archive size={14} aria-hidden /> Archived ({archivedCount})
                </span>
                <ChevronDown size={16} className={showArchived ? 'rotate-180' : ''} aria-hidden />
              </button>
              {showArchived ? (
                <ul className="kl-list opacity-80">
                  {activeTab === 'messages' && archivedDms.map((dm) =>
                    renderChannelRow(
                      { id: dm.channelId, name: dm.partnerName, description: null, visibility: 'dm', type: 'private', ministryId: null },
                      dm.partnerName,
                      { isDm: true }
                    )
                  )}
                  {activeTab === 'ministries' && archivedGroups.map((channel) => renderChannelRow(channel, channel.name))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      {rowMenu ? (
        <Portal>
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={() => setRowMenu(null)}>
            <div
              className="w-full max-w-[500px] lg:max-w-[400px] bg-white rounded-t-3xl lg:rounded-3xl shadow-2xl p-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Chat options"
            >
              <p className="px-4 pt-3 pb-2 text-sm text-gray-500 truncate">{rowMenu.title}</p>
              {archivedIds.has(rowMenu.id) ? (
                <button
                  type="button"
                  onClick={() => void toggleArchive(rowMenu.id, false)}
                  className="w-full min-h-[56px] flex items-center gap-4 px-4 text-base font-semibold text-[#1A1A1A] rounded-2xl active:bg-gray-50 hover:bg-gray-50"
                >
                  <ArchiveRestore size={20} className="text-burgundy" aria-hidden /> Unarchive chat
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void toggleArchive(rowMenu.id, true)}
                  className="w-full min-h-[56px] flex items-center gap-4 px-4 text-base font-semibold text-[#1A1A1A] rounded-2xl active:bg-gray-50 hover:bg-gray-50"
                >
                  <Archive size={20} className="text-burgundy" aria-hidden /> Archive chat
                </button>
              )}
              {isDmId(rowMenu.id) ? (
                <button
                  type="button"
                  onClick={() => {
                    const target = rowMenu;
                    setRowMenu(null);
                    setConfirmDelete(target);
                  }}
                  className="w-full min-h-[56px] flex items-center gap-4 px-4 text-base font-semibold text-rose-600 rounded-2xl active:bg-rose-50 hover:bg-rose-50"
                >
                  <Trash2 size={20} aria-hidden /> Delete chat
                </button>
              ) : null}
              {isDmId(rowMenu.id) ? (
                <>
                  <div className="my-1 mx-4 border-t border-gray-100" />
                  {blockedIds.has(rowMenu.id) ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void changeBlock(rowMenu.id, rowMenu.title, false)}
                      className="w-full min-h-[56px] flex items-center gap-4 px-4 text-base font-semibold text-[#1A1A1A] rounded-2xl active:bg-gray-50 hover:bg-gray-50"
                    >
                      <Ban size={20} className="text-burgundy" aria-hidden /> Unblock {rowMenu.title}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const target = rowMenu;
                        setRowMenu(null);
                        setConfirmBlock(target);
                      }}
                      className="w-full min-h-[56px] flex items-center gap-4 px-4 text-base font-semibold text-rose-600 rounded-2xl active:bg-rose-50 hover:bg-rose-50"
                    >
                      <Ban size={20} aria-hidden /> Block {rowMenu.title}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openReport(rowMenu)}
                    className="w-full min-h-[56px] flex items-center gap-4 px-4 text-base font-semibold text-rose-600 rounded-2xl active:bg-rose-50 hover:bg-rose-50"
                  >
                    <Flag size={20} aria-hidden /> Report to church leaders
                  </button>
                </>
              ) : null}
              <p className="px-4 pb-1 text-xs text-gray-500">
                Archived chats move to the bottom and come back when someone posts. Only you see this.
              </p>
            </div>
          </div>
        </Portal>
      ) : null}

      {confirmBlock ? (
        <DmBlockSheet
          target={confirmBlock}
          onClose={() => setConfirmBlock(null)}
          onBlocked={() => {
            markBlocked(confirmBlock.id, true);
            flash(`${confirmBlock.title} is blocked. They can’t message you.`);
            setConfirmBlock(null);
          }}
          onReportInstead={() => openReport(confirmBlock)}
        />
      ) : null}

      {reportFor ? (
        <DmReportSheet
          target={reportFor}
          alreadyBlocked={blockedIds.has(reportFor.id)}
          onClose={() => setReportFor(null)}
          onSent={(alsoBlocked) => {
            if (alsoBlocked) markBlocked(reportFor.id, true);
            flash(
              alsoBlocked
                ? `Report sent to church leaders, and ${reportFor.title} is blocked. Thank you.`
                : 'Report sent to church leaders. Thank you.',
              6000
            );
            setReportFor(null);
          }}
        />
      ) : null}

      {confirmDelete ? (
        <Portal>
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center"
            onClick={() => !deleting && setConfirmDelete(null)}
          >
            <div
              className="w-full max-w-[500px] lg:max-w-[400px] bg-white rounded-t-3xl lg:rounded-3xl shadow-2xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="dm-delete-title"
              aria-describedby="dm-delete-desc"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
                <Trash2 size={22} aria-hidden />
              </div>
              <h2 id="dm-delete-title" className="text-lg font-bold text-[#1A1A1A]">
                Delete chat with {confirmDelete.title}?
              </h2>
              <p id="dm-delete-desc" className="text-sm text-gray-600 mt-1">
                The chat and its messages are removed for you only. {confirmDelete.title} still has their copy. If either of you writes again, it starts fresh.
              </p>
              <div className="mt-5 grid gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void deleteDm(confirmDelete.id, confirmDelete.title)}
                  className="w-full min-h-[52px] rounded-2xl bg-rose-600 text-white text-base font-bold inline-flex items-center justify-center gap-2 active:bg-rose-700 disabled:opacity-60"
                >
                  {deleting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Trash2 size={18} aria-hidden />}
                  {deleting ? 'Deleting…' : 'Delete chat'}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(null)}
                  className="w-full min-h-[52px] rounded-2xl bg-gray-100 text-[#1A1A1A] text-base font-bold active:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}

      {newChatOpen ? (
        <div
          className="fixed inset-0 z-[300] flex flex-col justify-end bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="New chat"
        >
          <button
            type="button"
            className="flex-1 cursor-default"
            aria-label="Close"
            onClick={closeNewChat}
          />
          <div className="bg-eggshell rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-lg font-bold text-[#1A1A1A]">New chat</h2>
              <button
                type="button"
                onClick={closeNewChat}
                className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-gray-500"
                aria-label="Close new chat"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-5 pb-3">
              <label className="sr-only" htmlFor="chat-member-search">
                Search members
              </label>
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  aria-hidden
                />
                <input
                  id="chat-member-search"
                  type="search"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Type a name (e.g. Sheevon)…"
                  autoFocus
                  className="w-full h-12 rounded-2xl border border-gray-200 bg-white pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-burgundy/20"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-4 min-h-[12rem]">
              {searching ? (
                <div className="flex items-center justify-center gap-2 py-10 text-gray-500 text-sm">
                  <Loader2 className="animate-spin" size={16} />
                  Searching…
                </div>
              ) : searchError ? (
                <p className="text-sm text-burgundy py-6 text-center">{searchError}</p>
              ) : !searchQ.trim() ? (
                <p className="text-sm text-gray-500 py-6 text-center">
                  Type a name to find someone to message.
                  <span className="block mt-1 text-xs text-gray-500">
                    You don’t need @ here — that’s only for tagging in a channel.
                  </span>
                </p>
              ) : searchResults.length === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center">
                  No members match that name.
                </p>
              ) : (
                <ul className="space-y-2">
                  {searchResults.map((member) => (
                    <li key={member.id}>
                      <button
                        type="button"
                        disabled={openingPartnerId === member.id}
                        onClick={() => void startDm(member)}
                        className="w-full flex items-center gap-3 rounded-2xl bg-white border border-gray-100 p-3 text-left min-h-[56px] disabled:opacity-60"
                      >
                        <div className="w-10 h-10 rounded-full bg-burgundy/10 text-burgundy flex items-center justify-center shrink-0 overflow-hidden">
                          {member.avatarUrl ? (
                            <img
                              src={member.avatarUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User size={18} aria-hidden />
                          )}
                        </div>
                        <span className="text-sm font-bold text-[#1A1A1A] truncate flex-1">
                          {member.name}
                        </span>
                        {openingPartnerId === member.id ? (
                          <Loader2 className="animate-spin text-burgundy" size={16} />
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {/* Bible on the home screen (members asked for it here, not only inside a Ka Link). */}
      <Link to="/bible" className="kl-bible" data-testid="home-bible-card">
        <span className="kl-bible-icon">
          <BookOpen size={20} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Bible</span>
          <span className="block text-xs text-[#f4ecdb]/75">English &amp; Luganda · share verses</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-[#f1d58a]" aria-hidden />
      </Link>
      </div>

    </main>
  );
};
