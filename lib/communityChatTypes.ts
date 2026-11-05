export type CommunityChatChannel = {
  id: string;
  name: string;
  description: string | null;
  visibility: string | null;
  type: string | null;
  /** Present when Vault returns a ministry-scoped channel the member can already access. */
  ministryId: string | null;
  /** Announcements room: only leaders post; everyone reads and reacts. */
  announceOnly?: boolean;
};

export type ChatPinned = { id: string; content: string; authorName: string; pinnedAt: string | null };

export type ChatSearchHit = {
  id: string;
  channelId: string;
  channelName: string | null;
  content: string;
  authorName: string;
  createdAt: string | null;
};

export type ChatPerson = {
  id: string;
  name: string;
  /** In a group's member list: 'admin' = room moderator. */
  roomRole?: 'admin' | 'member';
  isCreator?: boolean;
  /** Added automatically from the ministry roster (removing them in chat may not stick). */
  fromMinistry?: boolean;
};

export type ChatGroupKind = 'open' | 'private' | 'ministry';

export type ChatDirectoryMember = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type CommunityChatAuthor = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type CommunityChatParent = {
  id: string;
  name: string;
  content: string | null;
  isDeleted: boolean;
};

export type CommunityChatMessage = {
  id: string;
  channelId: string;
  content: string;
  isDeleted: boolean;
  createdAt: string;
  author: CommunityChatAuthor;
  parent: CommunityChatParent | null;
  /** Photos, voice notes, videos and documents (signed links, ~1 hour). */
  attachments?: CommunityChatAttachment[];
  /** Set when the author edited the text. */
  editedAt?: string | null;
  reactions?: CommunityChatReaction[];
};

export type CommunityChatReaction = { emoji: string; userIds: string[] };

/** Someone else's read position in a room (for ✓✓ and "Seen by"). */
export type ChatReader = { userId: string; name: string; lastReadAt: string };

export type ChatMentionPerson = {
  id: string;
  name: string;
  /** "Pastor", "Leader", … for church leaders; null for members. */
  label?: string | null;
  /** The special "@everyone" entry (room leaders only). */
  everyone?: boolean;
};

export type CommunityChatAttachment = {
  id: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  name: string;
  mime: string;
  size: number;
  url: string | null;
};

/** LIVE presence for a channel (Connect-sanitized). */
export type HuddleChannelStatus = {
  live: boolean;
  participantCount: number;
};

/** Match Vault: a huddle is visible as LIVE only when someone is in the room. */
export function isHuddleChannelLive(status: unknown): status is HuddleChannelStatus {
  if (!status || typeof status !== 'object') return false;
  const s = status as { live?: unknown; participantCount?: unknown };
  return Boolean(s.live) && Number(s.participantCount) > 0;
}

/** Vault-minted LiveKit join payload (no secrets). */
export type HuddleJoinToken = {
  token: string;
  url: string;
  roomName: string;
  expiresIn: number;
  canModerate: boolean;
  channelId: string;
  channelName: string;
  /** Vault-signed 12h permission to reopen this huddle while Supabase is down. */
  fallbackPass?: string;
  /** True when this token came from the saved permission (database down). */
  fallback?: boolean;
};

export type CommunityChatErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'bridge_unconfigured'
  | 'vault_unavailable'
  | 'huddle_unavailable'
  | 'invalid_upstream'
  | 'invalid_body'
  | 'session_missing'
  | 'network'
  | 'fallback_expired'
  | 'backup_line_unconfigured'
  | 'backup_line_unavailable'
  | 'huddle_line_busy'
  | 'huddle_not_started'
  | 'upload_failed'
  | 'too_large';

export class CommunityChatError extends Error {
  code: CommunityChatErrorCode;
  status: number;
  sessionInvalid: boolean;

  constructor(
    code: CommunityChatErrorCode,
    message: string,
    status: number,
    sessionInvalid = false
  ) {
    super(message);
    this.name = 'CommunityChatError';
    this.code = code;
    this.status = status;
    this.sessionInvalid = sessionInvalid;
  }
}

export function isDmChannel(channel: Pick<CommunityChatChannel, 'visibility' | 'name'>): boolean {
  const v = String(channel.visibility || '').toLowerCase();
  return v === 'dm' || String(channel.name || '').startsWith('DM_');
}

/** A poll riding on a chat message. */
export type ChatPollOption = { id: string; text: string; count: number; voters: string[] };
export type ChatPoll = {
  id: string;
  messageId: string;
  question: string;
  multi: boolean;
  anonymous: boolean;
  closed: boolean;
  isMine: boolean;
  totalVoters: number;
  myVotes: string[];
  options: ChatPollOption[];
};

/** Chat text that marks a poll message (shown as-is in apps that don't draw the poll card). */
export const POLL_MESSAGE_PREFIX = '📊 Poll: ';

/** Event / Serve cards shared into a chat. */
export type ChatEventCard = {
  id: string;
  title: string;
  startsAt: string | null;
  timeLabel: string | null;
  endTime: string | null;
  location: string | null;
  imageUrl: string | null;
  signupUrl: string | null;
  going: boolean;
  goingCount: number;
};
export type ChatServeCard = {
  id: string;
  title: string;
  roleLabel: string | null;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  capacity: number | null;
  spotsLeft: number | null;
  open: boolean;
  requiresApproval: boolean;
  mySignup: 'pending' | 'confirmed' | null;
};
export type ChatCard =
  | { messageId: string; kind: 'event'; event?: ChatEventCard; missing?: boolean }
  | { messageId: string; kind: 'serve'; serve?: ChatServeCard; missing?: boolean };
export type ChatCardOptions = {
  events: Array<{ id: string; title: string; startsAt: string | null; location: string | null }>;
  serve: Array<{ id: string; title: string; roleLabel: string | null; startsAt: string | null }>;
};

/** Chat text that marks a shared event / Serve need (shown as-is in apps that don't draw the card). */
export const EVENT_CARD_PREFIX = '📅 Event: ';
export const SERVE_CARD_PREFIX = '🙋 Serve: ';
export function isCardMessageText(content: string | null | undefined): boolean {
  const c = String(content || '');
  return c.startsWith(EVENT_CARD_PREFIX) || c.startsWith(SERVE_CARD_PREFIX);
}

/** Help requests (ride, visit, meal…) with tracking and assignments. */
export type ChatRequestCategory = 'ride' | 'visit' | 'meal' | 'errand' | 'other';
export type ChatRequestStatus = 'new' | 'assigned' | 'done' | 'cancelled';
export type ChatRequestAction = 'volunteer' | 'assign' | 'unassign' | 'done' | 'reopen' | 'cancel' | 'note';
export type ChatRequest = {
  id: string;
  messageId: string;
  channelId: string | null;
  category: ChatRequestCategory;
  categoryLabel: string;
  details: string;
  status: ChatRequestStatus;
  askedBy: { id: string; name: string };
  helper: { id: string; name: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  doneAt: string | null;
  isMine: boolean;
  isHelper: boolean;
  can: Record<ChatRequestAction, boolean>;
  history: Array<{ action: string; by: string; note: string | null; at: string | null; to: string | null }>;
};
export const REQUEST_PREFIX = '🤝 Request: ';
export const REQUEST_CATEGORY_OPTIONS: Array<{ id: ChatRequestCategory; label: string; hint: string }> = [
  { id: 'ride', label: 'Ride', hint: 'To church, the doctor, the store' },
  { id: 'visit', label: 'Visit', hint: 'Home or hospital visit' },
  { id: 'meal', label: 'Meal', hint: 'A cooked meal or groceries' },
  { id: 'errand', label: 'Errand', hint: 'Help at home or an errand' },
  { id: 'other', label: 'Something else', hint: 'Any other help' },
];
