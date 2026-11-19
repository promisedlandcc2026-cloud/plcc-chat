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
  MessageCircle,
  Users,
  BookOpen,
  ChevronRight,
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
import { HuddleLiveBadge } from '../components/huddle/HuddleLiveDot';
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
import { MemberPageHeader } from '../components/member/MemberPageHeader';
import { ChatAlertsCard } from '../components/chat/ChatAlertsCard';
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
  parseChatHomeTab,
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

const GATHERING_ICONS: Record<PrayerGatheringKey, React.ReactNode> = {
  'morning-glory': <Sunrise size={22} aria-hidden />,
  'lunch-hour': <Sun size={22} aria-hidden />,
  'midnight-watch': <MoonStar size={22} aria-hidden />,
  'upper-room': <Church size={22} aria-hidden />,
  intercessors: <HandHeart size={22} aria-hidden />,
};

const SEARCH_DEBOUNCE_MS = 280;

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
  const { byChannel: huddleByChannel } = useHuddleLive();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  /** Which home tab is showing (URL ?tab= wins, then this visit's last tab, then Prayer). */
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const activeTab: ChatHomeTab = urlTab ? parseChatHomeTab(urlTab) : readStoredChatHomeTab() ?? 'prayer';
  const setActiveTab = (tab: ChatHomeTab) => {
    storeChatHomeTab(tab);
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
      navigate(`/community/chat/${channel.id}`, {
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
    const row = (
        <Link
          to={`/community/chat/${channel.id}`}
          state={{
            channelName: title,
            partnerName: opts?.isDm ? title : undefined,
            isDm: Boolean(opts?.isDm),
          }}
          aria-current={active ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-2xl border shadow-sm p-4 transition-colors min-h-[64px] ${
            active ? 'bg-burgundy/5 border-burgundy/40' : 'bg-white border-gray-100 hover:border-burgundy/20'
          }`}
        >
          <div className="w-11 h-11 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center shrink-0">
            {opts?.isDm ? <User size={18} aria-hidden /> : <MessageCircle size={18} aria-hidden />}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-2 min-w-0">
              {channel.announceOnly && !opts?.isDm ? (
                <Megaphone size={14} className="text-gold-ink shrink-0" aria-label="Announcements" />
              ) : null}
              <p className="text-sm font-bold text-[#1A1A1A] truncate">{title}</p>
              {live ? <HuddleLiveBadge count={huddle?.participantCount} /> : null}
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {visibilityLabel(opts?.isDm ? 'dm' : channel.visibility)}
              {opts?.isDm && blockedIds.has(channel.id) ? ' · Blocked' : ''}
              {live && huddle?.participantCount
                ? ` · ${huddle.participantCount} in Ka Link`
                : ''}
              {!live && !opts?.isDm && channel.description
                ? ` · ${channel.description}`
                : ''}
            </p>
          </div>
          {unread > 0 ? (
            <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-burgundy text-white text-xs font-black leading-[22px] text-center">
              {unread > 99 ? '99+' : unread}
            </span>
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
    <main className="flex-1 px-5 pt-6 pb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <img
          src="/awc_chat_wordmark.png"
          alt="PLCC Ka Link"
          width={117}
          height={32}
          className="h-8 w-auto select-none"
          draggable={false}
        />
        <BackToAwcOne />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 mb-6">
        <AccountMenu />
        <div className="flex items-center">
          {canCreateGroups ? (
            <button
              type="button"
              onClick={() => setNewGroupOpen(true)}
              className="inline-flex items-center gap-1 text-burgundy text-sm font-bold min-h-[44px] px-1.5"
              aria-label="New group"
            >
              <Users size={16} aria-hidden />
              Group
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setNewChatOpen(true)}
            className="inline-flex items-center gap-1 text-burgundy text-sm font-bold min-h-[44px] px-1.5"
            aria-label="New chat"
          >
            <Plus size={16} aria-hidden />
            New
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center justify-center text-burgundy min-h-[44px] min-w-[44px] rounded-full hover:bg-burgundy/5"
            aria-label="Refresh chats"
            title="Refresh"
          >
            <RefreshCcw size={18} aria-hidden />
          </button>
        </div>
      </div>

      <MemberPageHeader
        title="Chat"
        backTo={null}
        subtitle={`${identity?.name ? `Signed in as ${identity.name}. ` : ''}Prayer gatherings, ministry rooms, messages and Live Ka Links — each in its own tab.`}
      />

      <ChatAlertsCard />

      <ChatNavTabs
        active={activeTab}
        onChange={setActiveTab}
        prayerUnread={prayerUnread}
        ministryUnread={ministryUnread}
        messageUnread={messageUnread}
        liveCount={liveRows.length}
      />

      {/* Bible on the home screen (members asked for it here, not only inside a Ka Link). */}
      <Link
        to="/bible"
        className="mb-4 flex min-h-[64px] items-center gap-3 rounded-2xl border border-[#d9b45e]/60 bg-gradient-to-r from-[#0f3d2c] to-[#062a1d] px-4 py-3 text-[#f4ecdb] shadow-sm active:scale-[0.99]"
        data-testid="home-bible-card"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#d9b45e]/15 text-[#f1d58a]">
          <BookOpen size={20} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">Bible</span>
          <span className="block text-xs text-[#f4ecdb]/75">Read in English and Luganda · share a verse to any chat</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-[#f1d58a]" aria-hidden />
      </Link>

      <label className="relative block mb-5">
        <span className="sr-only">Search messages</span>
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          value={msgQ}
          onChange={(e) => setMsgQ(e.target.value)}
          placeholder="Search all messages…"
          className="w-full min-h-[48px] rounded-2xl border border-gray-200 bg-white pl-10 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
        />
        {msgQ ? (
          <button
            type="button"
            onClick={() => setMsgQ('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-gray-500"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        ) : null}
      </label>

      {msgQ.trim().length >= 2 ? (
        <section className="mb-8" aria-label="Search results">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2 px-1">Messages</h2>
          {msgHits === null || (msgSearching && !msgHits.length) ? (
            <p className="text-sm text-gray-500 flex items-center gap-2 px-1">
              <Loader2 className="animate-spin" size={16} /> Searching…
            </p>
          ) : msgHits.length ? (
            <ul className="rounded-2xl bg-white border border-gray-100 divide-y divide-gray-100">
              {msgHits.map((h) => (
                <li key={h.id}>
                  <Link
                    to={`/community/chat/${h.channelId}?m=${h.id}`}
                    state={{ channelName: h.channelName || undefined }}
                    className="block px-4 py-3 hover:bg-gray-50 active:bg-gray-50"
                  >
                    <span className="block text-xs font-bold text-burgundy">
                      {h.channelName || 'Chat'} · {h.authorName}
                      {h.createdAt ? ` · ${new Date(h.createdAt).toLocaleDateString()}` : ''}
                    </span>
                    <span className="block text-sm text-[#1A1A1A] line-clamp-2">{h.content}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 px-1">No messages found.</p>
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
        <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          Loading channels…
        </div>
      ) : error ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
          <p className="text-sm text-burgundy font-medium">{error}</p>
          <Button type="button" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {toast ? (
            <p className="rounded-2xl bg-wine text-cream text-sm px-4 py-3" role="status">
              {toast}
            </p>
          ) : null}
          {activeTab === 'prayer' ? (
            <div role="tabpanel" id="chat-panel-prayer" aria-labelledby="chat-tab-prayer" className="space-y-3">
              <div className="px-1">
                <h2 className="text-lg font-bold text-[#1A1A1A]">Prayer Gathering</h2>
                <p className="text-sm text-gray-500">Tap a gathering to open its room. A green Live mark means people are praying now.</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-1">
                {PRAYER_GATHERINGS.map((g) => {
                  const room = gatherings[g.key];
                  const huddle = room ? huddleByChannel[room.id] : undefined;
                  const live = room ? isHuddleChannelLive(huddle) : false;
                  const unread = room ? unreadOf(room.id) : 0;
                  const lockedIntercessors = g.key === 'intercessors' && !room && intercessors && !intercessors.allowed;
                  const body = (
                    <>
                      <span
                        className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center ${
                          room ? 'bg-gradient-to-br from-burgundy to-wine text-gold' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {GATHERING_ICONS[g.key]}
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`text-base font-bold truncate ${room ? 'text-[#1A1A1A]' : 'text-gray-500'}`}>{g.name}</span>
                          {live ? <HuddleLiveBadge /> : null}
                        </span>
                        <span className="block text-xs text-gray-500 mt-0.5">
                          {live && huddle?.participantCount
                            ? `${huddle.participantCount} praying now · tap to join`
                            : room
                              ? g.blurb
                              : lockedIntercessors
                                ? 'For the Intercessors team.'
                                : 'This room is not open yet.'}
                        </span>
                      </span>
                      {unread > 0 ? (
                        <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-burgundy text-white text-xs font-black leading-[22px] text-center">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      ) : null}
                      {lockedIntercessors ? <Lock size={16} className="text-gray-400 shrink-0" aria-hidden /> : null}
                      {room && live ? (
                        <span className="shrink-0 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider px-3 py-2">
                          Join
                        </span>
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
                          className={`flex items-center gap-3 rounded-2xl border shadow-sm p-4 min-h-[76px] transition-colors ${
                            activeChannelId === room.id
                              ? 'bg-burgundy/5 border-burgundy/40'
                              : live
                                ? 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-300'
                                : 'bg-white border-gray-100 hover:border-burgundy/25'
                          }`}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div
                          className="flex items-center gap-3 rounded-2xl border border-dashed border-gray-200 bg-white/60 p-4 min-h-[76px]"
                          data-prayer-gathering={g.key}
                          aria-disabled="true"
                        >
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
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2 px-1">
                Ministry channels
              </h2>
              {activeGroups.length === 0 ? (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 text-sm text-gray-500">
                  No ministry channels are available yet.
                </div>
              ) : (
                <ul className="space-y-2">
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
              <div className="flex items-center justify-between gap-2 mb-2 px-1">
                <h2 className="text-xs font-black uppercase tracking-widest text-gray-500">Messages</h2>
                <button
                  type="button"
                  onClick={() => setNewChatOpen(true)}
                  className="inline-flex items-center gap-1 rounded-xl bg-burgundy text-white text-sm font-bold min-h-[44px] px-3"
                >
                  <Plus size={16} aria-hidden /> New message
                </button>
              </div>
              {activeDms.length === 0 ? (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 text-sm text-gray-500">
                  No private messages yet. Tap New message to write to a member.
                </div>
              ) : (
                <>
                {showSwipeTip ? (
                  <div className="mb-2 flex items-center gap-3 rounded-2xl bg-burgundy/5 border border-burgundy/10 pl-4 pr-1 py-1">
                    <span className="text-burgundy shrink-0 inline-flex" aria-hidden>
                      <ChevronsLeft size={18} className="animate-pulse" />
                    </span>
                    <p className="flex-1 text-xs text-gray-600 leading-snug">
                      {touch
                        ? 'Tip: swipe a chat left to archive or delete it. Press and hold to block or report.'
                        : 'Tip: right-click a chat to archive, delete, block or report.'}
                    </p>
                    <button
                      type="button"
                      onClick={hideSwipeTip}
                      className="shrink-0 min-h-[40px] px-3 rounded-xl text-xs font-bold text-burgundy active:bg-burgundy/10"
                    >
                      Got it
                    </button>
                  </div>
                ) : null}
                <ul className="space-y-2">
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
            <section role="tabpanel" id="chat-panel-huddles" aria-labelledby="chat-tab-huddles" className="space-y-3">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 px-1 flex items-center gap-2">
                <Radio size={14} className="text-emerald-600" aria-hidden /> Live Ka Links now
              </h2>
              {liveRows.length === 0 ? (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 text-sm text-gray-500 space-y-2">
                  <p>No Live Ka Links right now.</p>
                  <p>When a prayer gathering or ministry room goes live, it shows up here so you can join in one tap. To start one, open any room and tap Start Ka Link.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {liveRows.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={huddleRoomPath(row.id, 'join')}
                        state={{ channelName: row.name }}
                        className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 shadow-sm p-4 transition-colors min-h-[64px] hover:border-emerald-300"
                      >
                        <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                          <Radio size={18} aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-bold text-[#1A1A1A] truncate">{row.name}</p>
                            <HuddleLiveBadge count={row.count} />
                          </div>
                          <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                            {row.count > 0 ? `${row.count} in Ka Link · Tap to join` : 'Tap to join'}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider px-3 py-2">
                          Join
                        </span>
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
                className="w-full min-h-[48px] flex items-center justify-between px-1 text-xs font-black uppercase tracking-widest text-gray-500"
                aria-expanded={showArchived}
              >
                <span className="inline-flex items-center gap-2">
                  <Archive size={14} aria-hidden /> Archived ({archivedCount})
                </span>
                <ChevronDown size={16} className={showArchived ? 'rotate-180' : ''} aria-hidden />
              </button>
              {showArchived ? (
                <ul className="space-y-2 opacity-80">
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
    </main>
  );
};
