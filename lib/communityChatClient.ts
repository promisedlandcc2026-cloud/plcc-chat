import { getValidAccessToken, refreshAccessToken } from './authAccessToken';
import {
  CommunityChatError,
  type ChatDirectoryMember,
  type ChatMentionPerson,
  type ChatGroupKind,
  type ChatPerson,
  type ChatPinned,
  type ChatPoll,
  POLL_MESSAGE_PREFIX,
  type ChatCard,
  type ChatCardOptions,
  EVENT_CARD_PREFIX,
  SERVE_CARD_PREFIX,
  type ChatRequest,
  type ChatRequestAction,
  type ChatRequestCategory,
  REQUEST_PREFIX,
  REQUEST_CATEGORY_OPTIONS,
  type ChatSearchHit,
  type ChatReader,
  type CommunityChatChannel,
  type CommunityChatErrorCode,
  type CommunityChatMessage,
  type HuddleChannelStatus,
  type HuddleJoinToken,
} from './communityChatTypes';

async function getAccessToken(): Promise<string | null> {
  return getValidAccessToken();
}

/** Shown when a member opens a huddle nobody has started (only leaders / room moderators can start). */
export const HUDDLE_NOT_STARTED_MESSAGE =
  "This huddle hasn't started yet. A leader or room moderator will start it — you can join as soon as it's live.";

function mapStatus(
  status: number,
  bodyCode?: string
): { code: CommunityChatErrorCode; message: string } {
  if (status === 401) {
    return { code: 'unauthorized', message: 'Please sign in again to continue.' };
  }
  if (status === 403 && bodyCode === 'huddle_not_started') {
    return { code: 'huddle_not_started', message: HUDDLE_NOT_STARTED_MESSAGE };
  }
  if (status === 403) {
    return {
      code: 'forbidden',
      message: 'You do not have access to this chat.',
    };
  }
  if (status === 404) {
    return { code: 'not_found', message: 'That channel could not be found.' };
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      message: 'Too many requests. Please wait a moment and try again.',
    };
  }
  if (status === 503) {
    if (bodyCode === 'huddle_unavailable') {
      return {
        code: 'huddle_unavailable',
        message: 'Live Huddle is not available right now. Please try again later.',
      };
    }
    return {
      code: 'bridge_unconfigured',
      message: 'Chat is not available right now. Please try again later.',
    };
  }
  return {
    code: 'vault_unavailable',
    message: 'Chat is temporarily unavailable. Please try again.',
  };
}

async function readErrorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { code?: string };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

async function authedFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    throw new CommunityChatError(
      'session_missing',
      'Please sign in again to continue.',
      401,
      true
    );
  }

  const doFetch = async (bearer: string) =>
    fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {}),
        Authorization: `Bearer ${bearer}`,
      },
    });

  try {
    let res = await doFetch(token);
    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        res = await doFetch(refreshed);
      }
    }
    return res;
  } catch (err) {
    if (err instanceof CommunityChatError) throw err;
    throw new CommunityChatError(
      'network',
      'Chat is temporarily unavailable. Please try again.',
      0
    );
  }
}

export async function fetchChatChannels(opts?: {
  signal?: AbortSignal;
}): Promise<CommunityChatChannel[]> {
  const res = await authedFetch('/api/community-chat?resource=channels', {
    method: 'GET',
    signal: opts?.signal,
  });
  if (!res.ok) {
    const mapped = mapStatus(res.status);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    channels?: CommunityChatChannel[];
  };
  if (body.ok !== true || !Array.isArray(body.channels)) {
    throw new CommunityChatError(
      'vault_unavailable',
      'Chat is temporarily unavailable. Please try again.',
      502
    );
  }
  return body.channels;
}

export async function fetchChatMessages(
  channelId: string,
  opts?: { signal?: AbortSignal }
): Promise<CommunityChatMessage[]> {
  const qs = new URLSearchParams({ resource: 'messages', channelId });
  const res = await authedFetch(`/api/community-chat?${qs}`, {
    method: 'GET',
    signal: opts?.signal,
  });
  if (!res.ok) {
    const mapped = mapStatus(res.status);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    messages?: CommunityChatMessage[];
  };
  if (body.ok !== true || !Array.isArray(body.messages)) {
    throw new CommunityChatError(
      'vault_unavailable',
      'Chat is temporarily unavailable. Please try again.',
      502
    );
  }
  return body.messages;
}

export async function sendChatMessage(
  channelId: string,
  content: string,
  opts?: { parentId?: string | null; mentionedUserIds?: string[] }
): Promise<CommunityChatMessage> {
  const res = await authedFetch('/api/community-chat?resource=messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId,
      content,
      ...(opts?.parentId ? { parentId: opts.parentId } : {}),
      ...(opts?.mentionedUserIds?.length ? { mentionedUserIds: opts.mentionedUserIds.slice(0, 20) } : {}),
    }),
  });
  if (!res.ok) {
    const mapped = mapStatus(res.status);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    message?: CommunityChatMessage;
  };
  if (body.ok !== true || !body.message) {
    throw new CommunityChatError(
      'vault_unavailable',
      'Chat is temporarily unavailable. Please try again.',
      502
    );
  }
  return body.message;
}

async function postJson<T>(resource: string, body: unknown, fallback: string): Promise<T> {
  const res = await authedFetch(`/api/community-chat?resource=${resource}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data?.ok !== true) {
    const mapped = mapStatus(res.status, data?.code);
    throw new CommunityChatError(
      mapped.code,
      typeof data?.message === 'string' && res.status !== 401 ? data.message : fallback || mapped.message,
      res.status,
      res.status === 401
    );
  }
  return data as T;
}

/** Pin / unpin a message (room leaders). Returns the room's pins. */
export async function setPinned(messageId: string, pinned: boolean): Promise<ChatPinned[]> {
  const d = await postJson<{ pinned: ChatPinned[] }>('pin', { messageId, pinned }, 'Could not pin that message.');
  return Array.isArray(d.pinned) ? d.pinned : [];
}

/** Search messages in one room, or every room you're in when channelId is omitted. */
export async function searchChatMessages(q: string, channelId?: string): Promise<ChatSearchHit[]> {
  const d = await postJson<{ results: ChatSearchHit[] }>(
    'search',
    channelId ? { q, channelId } : { q },
    'Search is not available right now.'
  );
  return Array.isArray(d.results) ? d.results : [];
}

/** Group admins: rename, describe, or switch "only leaders can post". */
export async function updateGroupSettings(
  channelId: string,
  patch: { name?: string; description?: string; announceOnly?: boolean }
): Promise<CommunityChatChannel | null> {
  const d = await postJson<{ channel: CommunityChatChannel | null }>(
    'room-settings',
    { channelId, ...patch },
    'Could not save the group settings.'
  );
  return d.channel;
}

/** Church leaders: create a group (open to everyone, private, or a ministry's). */
export async function createGroup(input: {
  name: string;
  description?: string;
  kind: ChatGroupKind;
  ministryId?: string | null;
  memberIds: string[];
  announceOnly: boolean;
}): Promise<CommunityChatChannel> {
  const d = await postJson<{ channel: CommunityChatChannel }>(
    'group-create',
    {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      kind: input.kind,
      ...(input.kind === 'ministry' && input.ministryId ? { ministryId: input.ministryId } : {}),
      memberIds: input.memberIds,
      announceOnly: input.announceOnly,
    },
    'Could not create the group.'
  );
  return d.channel;
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const res = await authedFetch(path, { method: 'GET' });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data?.ok !== true) {
    throw new CommunityChatError(
      mapStatus(res.status, data?.code).code,
      typeof data?.message === 'string' ? data.message : fallback,
      res.status,
      res.status === 401
    );
  }
  return data as T;
}

export type ChatDmConversation = {
  channelId: string;
  partnerId: string;
  partnerName: string;
  lastMessageAt: string | null;
  lastMessage: string | null;
};

/** Your direct conversations, from the Vault (same on every device). null if unavailable. */
export async function fetchDmList(): Promise<ChatDmConversation[] | null> {
  try {
    const d = await getJson<{ conversations: ChatDmConversation[] }>('/api/community-chat?resource=dm-list', '');
    return Array.isArray(d.conversations) ? d.conversations : [];
  } catch {
    return null;
  }
}

/** Chats you archived (hidden until someone else posts again). null if unavailable. */
export async function fetchArchivedChatIds(): Promise<Set<string> | null> {
  try {
    const d = await getJson<{ archived: Array<{ channelId: string }> }>('/api/community-chat?resource=archives', '');
    return new Set((d.archived || []).map((a) => a.channelId));
  } catch {
    return null;
  }
}

export async function setChatArchived(channelId: string, archived: boolean): Promise<void> {
  await postJson('room-archive', { channelId, archived }, archived ? 'Could not archive this chat.' : 'Could not unarchive this chat.');
}

export async function fetchGroupMembers(channelId: string): Promise<ChatPerson[]> {
  const d = await getJson<{ people: ChatPerson[] }>(
    `/api/community-chat?resource=group-members&channelId=${encodeURIComponent(channelId)}`,
    'Could not load the members.'
  );
  return d.people || [];
}

/** People to add (to a new group, or to channelId — then current members are left out). */
export async function searchPeople(q: string, channelId?: string): Promise<ChatPerson[]> {
  const d = await getJson<{ people: ChatPerson[] }>(
    `/api/community-chat?resource=people&q=${encodeURIComponent(q.slice(0, 40))}${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}`,
    'Could not search members.'
  );
  return d.people || [];
}

export async function fetchMyMinistries(): Promise<Array<{ id: string; name: string }>> {
  const d = await getJson<{ ministries: Array<{ id: string; name: string }> }>(
    '/api/community-chat?resource=ministries',
    'Could not load ministries.'
  );
  return d.ministries || [];
}

export async function addGroupMembers(channelId: string, userIds: string[]): Promise<ChatPerson[]> {
  const d = await postJson<{ members: ChatPerson[] }>('group-member-add', { channelId, userIds }, 'Could not add those people.');
  return d.members || [];
}

export async function removeGroupMember(channelId: string, userId: string): Promise<void> {
  await postJson('group-member-remove', { channelId, userId }, 'Could not remove that person.');
}

/** Add or remove your reaction. */
export async function setReaction(messageId: string, emoji: string, on: boolean): Promise<void> {
  await postJson('reaction', { messageId, emoji, on }, 'Could not react. Please try again.');
}

/** Edit your own message (within 24 hours). */
export async function editChatMessage(messageId: string, content: string): Promise<CommunityChatMessage> {
  const d = await postJson<{ message: CommunityChatMessage }>(
    'message-edit',
    { messageId, content },
    'Could not edit that message.'
  );
  return d.message;
}

/** Remove your own message for everyone. */
export async function removeChatMessage(messageId: string): Promise<void> {
  await postJson('message-delete', { messageId }, 'Could not remove that message.');
}

export type ChatReportReason = 'inappropriate' | 'harassment' | 'safety' | 'spam' | 'other';

/** Send someone else's message to church leaders for review. */
export async function reportChatMessage(messageId: string, reason: ChatReportReason, note: string): Promise<void> {
  await postJson('message-report', { messageId, reason, note: note.trim().slice(0, 500) }, 'Could not send that report.');
}

/** Everyone else's read position in this room. */
export async function fetchReadReceipts(channelId: string): Promise<ChatReader[]> {
  const d = await postJson<{ readers: ChatReader[] }>('read-receipts', { channelId }, '');
  return Array.isArray(d.readers) ? d.readers : [];
}

/** People in this room whose name starts with / contains q (for @mentions). */
export async function searchRoomMentions(channelId: string, q: string): Promise<ChatMentionPerson[]> {
  const res = await authedFetch(
    `/api/community-chat?resource=mentions&channelId=${encodeURIComponent(channelId)}&q=${encodeURIComponent(q.slice(0, 40))}`,
    { method: 'GET' }
  );
  if (!res.ok) return [];
  const d = (await res.json().catch(() => ({}))) as any;
  return Array.isArray(d?.people) ? d.people : [];
}

export async function fetchChatUnread(opts?: {
  signal?: AbortSignal;
}): Promise<{ count: number; byChannel: Record<string, number> }> {
  const res = await authedFetch('/api/community-chat?resource=unread', {
    method: 'GET',
    signal: opts?.signal,
  });
  if (!res.ok) {
    const mapped = mapStatus(res.status);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    count?: number;
    byChannel?: Record<string, number>;
  };
  if (body.ok !== true) {
    throw new CommunityChatError(
      'vault_unavailable',
      'Chat is temporarily unavailable. Please try again.',
      502
    );
  }
  return {
    count: typeof body.count === 'number' ? body.count : 0,
    byChannel: body.byChannel && typeof body.byChannel === 'object' ? body.byChannel : {},
  };
}

export async function markChatChannelRead(channelId: string): Promise<void> {
  const res = await authedFetch('/api/community-chat?resource=unread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  if (!res.ok) {
    const mapped = mapStatus(res.status);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
}

/**
 * Batch LIVE huddle presence for known channel IDs (~10s poll on Chat list).
 */
export async function fetchHuddleStatuses(
  channelIds: string[],
  opts?: { signal?: AbortSignal }
): Promise<Record<string, HuddleChannelStatus>> {
  if (channelIds.length === 0) return {};
  const qs = new URLSearchParams({
    resource: 'huddle-status',
    channelIds: channelIds.join(','),
  });
  const res = await authedFetch(`/api/community-chat?${qs}`, {
    method: 'GET',
    signal: opts?.signal,
  });
  if (!res.ok) {
    const code = await readErrorCode(res);
    const mapped = mapStatus(res.status, code);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    byChannel?: Record<string, HuddleChannelStatus>;
  };
  if (body.ok !== true || !body.byChannel || typeof body.byChannel !== 'object') {
    throw new CommunityChatError(
      'vault_unavailable',
      'Chat is temporarily unavailable. Please try again.',
      502
    );
  }
  return body.byChannel;
}

export type ChatRoomInfo = {
  /** Private live-update channel for this room (null when the Vault has none). */
  topic: string | null;
  canStart: boolean;
  muted: boolean;
  /** Room name (null for direct messages). */
  name: string | null;
  announceOnly: boolean;
  visibility: string | null;
  description: string | null;
  canPost: boolean;
  canPin: boolean;
  canManage: boolean;
  pinned: ChatPinned[];
};

/** Live-update channel, Start-button hint and mute state for one room. null when unknown. */
export async function fetchRoomInfo(channelId: string): Promise<ChatRoomInfo | null> {
  try {
    const res = await authedFetch('/api/community-chat?resource=room-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as any;
    if (b?.ok !== true) return null;
    return {
      topic: typeof b.topic === 'string' ? b.topic : null,
      canStart: b.canStart === true,
      muted: b.muted === true,
      name: typeof b.name === 'string' && b.name ? b.name : null,
      announceOnly: b.announceOnly === true,
      visibility: typeof b.visibility === 'string' ? b.visibility : null,
      description: typeof b.description === 'string' && b.description ? b.description : null,
      canPost: b.canPost !== false,
      canPin: b.canPin === true,
      canManage: b.canManage === true,
      pinned: Array.isArray(b.pinned) ? b.pinned : [],
    };
  } catch {
    return null;
  }
}

/** Mute / unmute phone alerts for one room. Returns the new state. */
export async function setRoomMuted(channelId: string, muted: boolean): Promise<boolean> {
  const res = await authedFetch('/api/community-chat?resource=room-mute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, muted }),
  });
  const b = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || b?.ok !== true) {
    throw new CommunityChatError('vault_unavailable', b?.message || 'Could not change alerts for this chat.', res.status);
  }
  return b.muted === true;
}

/**
 * May this member START this room's huddle? Leaders, room moderators/creators,
 * and Ministry Leaders in their own ministry rooms can. UI hint only — Vault
 * enforces the rule when the token is requested. Returns null when unknown.
 */
export async function fetchHuddleCanStart(channelId: string): Promise<boolean | null> {
  try {
    const res = await authedFetch('/api/community-chat?resource=huddle-can-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; canStart?: unknown };
    return body.ok === true ? body.canStart === true : null;
  } catch {
    return null;
  }
}

/**
 * Mint a Vault LiveKit join token (also starts an empty room on Vault).
 */
export async function fetchHuddleToken(
  channelId: string
): Promise<HuddleJoinToken> {
  const res = await authedFetch('/api/community-chat?resource=huddle-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  if (!res.ok) {
    const code = await readErrorCode(res);
    const mapped = mapStatus(res.status, code);
    let sessionInvalid = false;
    if (res.status === 401) {
      const again = await getAccessToken();
      sessionInvalid = !again;
    }
    throw new CommunityChatError(mapped.code, mapped.message, res.status, sessionInvalid);
  }
  const body = (await res.json()) as Partial<HuddleJoinToken> & { ok?: boolean };
  if (
    body.ok !== true ||
    typeof body.token !== 'string' ||
    typeof body.url !== 'string' ||
    typeof body.roomName !== 'string' ||
    typeof body.channelId !== 'string'
  ) {
    throw new CommunityChatError(
      'vault_unavailable',
      'Live Huddle is temporarily unavailable. Please try again.',
      502
    );
  }
  return {
    token: body.token,
    url: body.url,
    roomName: body.roomName,
    expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : 0,
    canModerate: Boolean(body.canModerate),
    channelId: body.channelId,
    channelName:
      typeof body.channelName === 'string' && body.channelName.trim()
        ? body.channelName
        : 'Channel',
    ...(typeof body.fallbackPass === 'string' && body.fallbackPass ? { fallbackPass: body.fallbackPass } : {}),
  };
}

/** End Live Huddle for everyone (Vault moderator gate). */
export async function endHuddle(channelId: string): Promise<void> {
  const res = await authedFetch('/api/community-chat?resource=huddle-end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  if (!res.ok) {
    const code = await readErrorCode(res);
    const mapped = mapStatus(res.status, code);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
}

/** Search approved members to start a DM (requires non-empty q). */
export async function searchChatDirectory(
  q: string,
  opts?: { signal?: AbortSignal }
): Promise<ChatDirectoryMember[]> {
  const qs = new URLSearchParams({ resource: 'directory', q: q.trim() });
  const res = await authedFetch(`/api/community-chat?${qs}`, {
    method: 'GET',
    signal: opts?.signal,
  });
  if (!res.ok) {
    const mapped = mapStatus(res.status);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    members?: ChatDirectoryMember[];
  };
  if (body.ok !== true || !Array.isArray(body.members)) {
    throw new CommunityChatError(
      'vault_unavailable',
      'Chat is temporarily unavailable. Please try again.',
      502
    );
  }
  return body.members;
}

/** Get-or-create a DM channel with a member. */
export async function openDirectMessage(
  partnerId: string
): Promise<{ channel: CommunityChatChannel; partnerId: string }> {
  const res = await authedFetch('/api/community-chat?resource=dm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partnerId }),
  });
  if (!res.ok) {
    const mapped = mapStatus(res.status);
    throw new CommunityChatError(
      mapped.code,
      mapped.message,
      res.status,
      res.status === 401
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    channel?: CommunityChatChannel;
    partnerId?: string;
  };
  if (body.ok !== true || !body.channel?.id) {
    throw new CommunityChatError(
      'vault_unavailable',
      'Chat is temporarily unavailable. Please try again.',
      502
    );
  }
  return {
    channel: body.channel,
    partnerId: typeof body.partnerId === 'string' ? body.partnerId : partnerId,
  };
}


// ── Polls ─────────────────────────────────────────────────────────────

/** Polls on these messages (up to 100 ids). Empty when none or polls aren't set up. */
export async function fetchPolls(messageIds: string[]): Promise<ChatPoll[]> {
  const ids = Array.from(new Set(messageIds)).slice(0, 100);
  if (!ids.length) return [];
  const res = await authedFetch(`/api/community-chat?resource=polls&messageIds=${encodeURIComponent(ids.join(','))}`, {
    method: 'GET',
  });
  if (!res.ok) return [];
  const d = (await res.json().catch(() => ({}))) as any;
  return Array.isArray(d?.polls) ? (d.polls as ChatPoll[]) : [];
}

/**
 * Start a poll: sends the poll's chat message (same rules as any message),
 * then attaches the poll to it. If attaching fails, the message is removed.
 */
export async function createPoll(
  channelId: string,
  input: { question: string; options: string[]; multi: boolean; anonymous: boolean }
): Promise<{ message: CommunityChatMessage; poll: ChatPoll }> {
  const message = await sendChatMessage(channelId, `${POLL_MESSAGE_PREFIX}${input.question}`.slice(0, 4000));
  try {
    const d = await postJson<{ poll: ChatPoll }>(
      'poll-create',
      { messageId: message.id, question: input.question, options: input.options, multi: input.multi, anonymous: input.anonymous },
      'Could not start that poll.'
    );
    return { message, poll: d.poll };
  } catch (err) {
    await removeChatMessage(message.id).catch(() => undefined);
    throw err;
  }
}

/** Vote (replaces your earlier vote). Pass [] to take your vote back. */
export async function votePoll(pollId: string, optionIds: string[]): Promise<string[]> {
  const d = await postJson<{ myVotes: string[] }>('poll-vote', { pollId, optionIds }, 'Could not save your vote.');
  return Array.isArray(d.myVotes) ? d.myVotes : optionIds;
}

export async function closePoll(pollId: string): Promise<void> {
  await postJson('poll-close', { pollId }, 'Could not close that poll.');
}


// ── Event & Serve cards ───────────────────────────────────────────────

export async function fetchCards(messageIds: string[]): Promise<ChatCard[]> {
  const ids = Array.from(new Set(messageIds)).slice(0, 100);
  if (!ids.length) return [];
  const res = await authedFetch(`/api/community-chat?resource=cards&messageIds=${encodeURIComponent(ids.join(','))}`, { method: 'GET' });
  if (!res.ok) return [];
  const d = (await res.json().catch(() => ({}))) as any;
  return Array.isArray(d?.cards) ? (d.cards as ChatCard[]) : [];
}

export async function fetchCardOptions(): Promise<ChatCardOptions> {
  const res = await authedFetch('/api/community-chat?resource=card-options', { method: 'GET' });
  const d = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new CommunityChatError('vault_unavailable', 'Could not load events right now.', res.status);
  return { events: Array.isArray(d?.events) ? d.events : [], serve: Array.isArray(d?.serve) ? d.serve : [] };
}

/** Share an event or Serve need: sends its chat message, then attaches the card. */
export async function shareCard(
  channelId: string,
  kind: 'event' | 'serve',
  refId: string,
  title: string,
  note?: string
): Promise<CommunityChatMessage> {
  const head = `${kind === 'event' ? EVENT_CARD_PREFIX : SERVE_CARD_PREFIX}${title}`;
  const message = await sendChatMessage(channelId, (note && note.trim() ? `${head}\n${note.trim()}` : head).slice(0, 4000));
  try {
    await postJson('card-create', { messageId: message.id, kind, refId }, 'Could not share that.');
    return message;
  } catch (err) {
    await removeChatMessage(message.id).catch(() => undefined);
    throw err;
  }
}

export async function setEventGoing(eventId: string, going: boolean, messageId?: string): Promise<{ going: boolean; goingCount: number }> {
  return postJson<{ going: boolean; goingCount: number }>(
    'card-going',
    { eventId, going, ...(messageId ? { messageId } : {}) },
    'Could not save that.'
  );
}

/** Serve sign-up / cancel — checked by PLCC Connect's Serve rules (eligibility). */
export async function serveSignup(opportunityId: string, action: 'signup' | 'cancel'): Promise<void> {
  await postJson('serve-signup', { opportunityId, action }, 'Could not save that. Please try again.');
}


// ── Help requests ─────────────────────────────────────────────────────

export async function fetchRequests(opts: { messageIds?: string[]; channelId?: string; scope?: 'open' | 'all' }): Promise<ChatRequest[]> {
  let qs = '';
  if (opts.channelId) qs = `&channelId=${encodeURIComponent(opts.channelId)}&scope=${opts.scope === 'all' ? 'all' : 'open'}`;
  else {
    const ids = Array.from(new Set(opts.messageIds || [])).slice(0, 100);
    if (!ids.length) return [];
    qs = `&messageIds=${encodeURIComponent(ids.join(','))}`;
  }
  const res = await authedFetch(`/api/community-chat?resource=requests${qs}`, { method: 'GET' });
  if (!res.ok) return [];
  const d = (await res.json().catch(() => ({}))) as any;
  return Array.isArray(d?.requests) ? (d.requests as ChatRequest[]) : [];
}

/** Ask for help: sends the request's chat message, then attaches the request. */
export async function createRequest(
  channelId: string,
  input: { category: ChatRequestCategory; details: string }
): Promise<{ message: CommunityChatMessage; request: ChatRequest }> {
  const label = REQUEST_CATEGORY_OPTIONS.find((o) => o.id === input.category)?.label || 'Help';
  const message = await sendChatMessage(channelId, `${REQUEST_PREFIX}${label}\n${input.details}`.slice(0, 4000));
  try {
    const d = await postJson<{ request: ChatRequest }>(
      'request-create',
      { messageId: message.id, category: input.category, details: input.details },
      'Could not send that request.'
    );
    return { message, request: d.request };
  } catch (err) {
    await removeChatMessage(message.id).catch(() => undefined);
    throw err;
  }
}

export async function updateRequest(
  requestId: string,
  action: ChatRequestAction,
  extra?: { assigneeId?: string; note?: string }
): Promise<ChatRequest> {
  const d = await postJson<{ request: ChatRequest }>(
    'request-update',
    { requestId, action, ...(extra?.assigneeId ? { assigneeId: extra.assigneeId } : {}), ...(extra?.note ? { note: extra.note } : {}) },
    'Could not update that request.'
  );
  return d.request;
}
