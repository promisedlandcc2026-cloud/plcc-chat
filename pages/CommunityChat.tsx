import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Loader2,
  Megaphone,
  MessageCircle,
  Users,
  Plus,
  RefreshCcw,
  Search,
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
import { dmDisplayName, listDmRecents, rememberDmRecent, replaceDmRecents } from '../lib/dmRecents';
import { Button } from '../components/ui/Button';
import { MemberPageHeader } from '../components/member/MemberPageHeader';
import { ChatAlertsCard } from '../components/chat/ChatAlertsCard';
import { AccountMenu } from '../components/chat/AccountMenu';
import { BackToAwcOne } from '../components/ui/BackToAwcOne';
import { NewGroupSheet } from '../components/chat/NewGroupSheet';
import { CHAT_LEADER_ROLES } from '../lib/chatRoles';
import { fetchArchivedChatIds, fetchDmList, searchChatMessages, setChatArchived } from '../lib/communityChatClient';
import { Portal } from '../components/chat/Portal';
import type { ChatSearchHit } from '../lib/communityChatTypes';

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
  const activeGroups = groupChannels.filter((c) => !archivedIds.has(c.id));
  const archivedGroups = groupChannels.filter((c) => archivedIds.has(c.id));
  const activeDms = dmRecents.filter((d) => !archivedIds.has(d.channelId));
  const archivedDms = dmRecents.filter((d) => archivedIds.has(d.channelId));
  const archivedCount = archivedGroups.length + archivedDms.length;

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
    return (
      <li key={channel.id} {...rowPressHandlers(channel.id, title)}>
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
              {live && huddle?.participantCount
                ? ` · ${huddle.participantCount} in huddle`
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
      </li>
    );
  };

  return (
    <main className="flex-1 px-5 pt-6 pb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <img
          src="/awc_chat_wordmark.png"
          alt="PLCC Chat"
          width={146}
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
        subtitle={`${identity?.name ? `Signed in as ${identity.name}. ` : ''}Message members, open your ministry rooms, and join a Live Huddle.`}
      />

      <ChatAlertsCard />

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
          {activeDms.length > 0 ? (
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2 px-1">
                Direct
              </h2>
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
            </section>
          ) : null}

          <section>
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2 px-1">
              Channels
            </h2>
            {activeGroups.length === 0 ? (
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 text-sm text-gray-500">
                No group channels are available yet. Use New to message a member.
              </div>
            ) : (
              <ul className="space-y-2">
                {activeGroups.map((channel) =>
                  renderChannelRow(
                    channel,
                    isDmChannel(channel)
                      ? dmDisplayName(channel.id, channel.name, ownerId)
                      : channel.name
                  )
                )}
              </ul>
            )}
          </section>

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
                  {archivedDms.map((dm) =>
                    renderChannelRow(
                      { id: dm.channelId, name: dm.partnerName, description: null, visibility: 'dm', type: 'private', ministryId: null },
                      dm.partnerName,
                      { isDm: true }
                    )
                  )}
                  {archivedGroups.map((channel) => renderChannelRow(channel, channel.name))}
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
              <p className="px-4 pb-1 text-xs text-gray-500">
                Archived chats move to the bottom and come back when someone posts. Only you see this.
              </p>
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
