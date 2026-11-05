/**
 * Small, pure helpers for message bubbles: read ticks, @mentions, reactions, editing.
 */
import type { ChatReader, CommunityChatMessage, CommunityChatReaction } from './communityChatTypes';

export const CHAT_REACTIONS = ['👍', '❤️', '🙏', '😂', '😮', '😢', '🙌', '🔥'] as const;
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** People (other than the author) who have read up to this message. */
export function seenBy(message: Pick<CommunityChatMessage, 'createdAt' | 'author'>, readers: ChatReader[]): ChatReader[] {
  const sent = Date.parse(message.createdAt);
  if (!Number.isFinite(sent)) return [];
  return readers.filter((r) => r.userId !== message.author.id && Date.parse(r.lastReadAt) >= sent);
}

/** ✓ sent · ✓✓ seen by someone (in a direct message: seen by them). */
export function tickState(seen: ChatReader[]): 'sent' | 'seen' {
  return seen.length > 0 ? 'seen' : 'sent';
}

export function seenLabel(seen: ChatReader[], isDm: boolean): string {
  if (!seen.length) return 'Sent';
  if (isDm) return 'Seen';
  const names = seen.map((r) => r.name.split(/\s+/)[0] || r.name);
  if (names.length <= 3) return `Seen by ${names.join(', ')}`;
  return `Seen by ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

export function canEdit(message: CommunityChatMessage, selfId: string, now = Date.now()): boolean {
  if (message.isDeleted || message.author.id !== selfId) return false;
  if (message.attachments && message.attachments.length > 0) return false; // captions stay as sent
  return now - Date.parse(message.createdAt) <= EDIT_WINDOW_MS;
}

/** Toggle my reaction locally (optimistic), keeping the fixed emoji order. */
export function toggleReaction(
  reactions: CommunityChatReaction[] | undefined,
  emoji: string,
  selfId: string
): { next: CommunityChatReaction[]; on: boolean } {
  const list = (reactions || []).map((r) => ({ emoji: r.emoji, userIds: [...r.userIds] }));
  const hit = list.find((r) => r.emoji === emoji);
  let on: boolean;
  if (hit && hit.userIds.includes(selfId)) {
    hit.userIds = hit.userIds.filter((id) => id !== selfId);
    on = false;
  } else if (hit) {
    hit.userIds.push(selfId);
    on = true;
  } else {
    list.push({ emoji, userIds: [selfId] });
    on = true;
  }
  const order = CHAT_REACTIONS as readonly string[];
  return {
    next: list.filter((r) => r.userIds.length > 0).sort((a, b) => order.indexOf(a.emoji) - order.indexOf(b.emoji)),
    on,
  };
}

/** Split text into plain parts and @mention parts (for bold highlighting). Never HTML. */
export function splitMentions(text: string): Array<{ text: string; mention: boolean }> {
  const out: Array<{ text: string; mention: boolean }> = [];
  const re = /(^|[\s(])(@[A-Za-z][A-Za-z0-9._-]{1,40})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: text.slice(last, start), mention: false });
    out.push({ text: m[2], mention: true });
    last = start + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

/** "@ann" being typed right before the caret → "ann" (else null). */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([A-Za-z][A-Za-z0-9._-]{0,30})?$/.exec(before);
  if (!m) return null;
  const query = m[2] || '';
  return { start: caret - query.length - 1, query };
}

/** Name to insert for a mention: first name only (matches how the Vault reads @names). */
export function mentionHandle(name: string): string {
  const first = String(name || '').trim().split(/\s+/)[0] || 'Member';
  return first.replace(/[^A-Za-z0-9._-]/g, '') || 'Member';
}

/** Ids of people still @mentioned in the final text. */
export function mentionIdsInText(text: string, picked: Map<string, string>): string[] {
  const ids: string[] = [];
  for (const [handle, id] of picked) {
    if (new RegExp(`(^|\\s)@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`).test(text)) ids.push(id);
  }
  return [...new Set(ids)];
}

export type RichPart = { kind: 'text' | 'mention' | 'link'; text: string; href?: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Only real web links become clickable (http/https). Trailing punctuation stays text. */
export function safeHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Text → plain text, @mentions and web links (never HTML). */
export function splitRich(text: string): RichPart[] {
  const out: RichPart[] = [];
  let last = 0;
  const pushText = (t: string) => {
    if (!t) return;
    for (const p of splitMentions(t)) out.push({ kind: p.mention ? 'mention' : 'text', text: p.text });
  };
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0];
    // "see https://x.org/page." → link "https://x.org/page" + "."
    const trail = /[.,!?;:)\]]+$/.exec(url);
    if (trail) url = url.slice(0, -trail[0].length);
    const href = safeHref(url);
    pushText(text.slice(last, m.index));
    if (href) out.push({ kind: 'link', text: url, href });
    else pushText(url);
    last = m.index + url.length;
    URL_RE.lastIndex = last;
  }
  pushText(text.slice(last));
  return out;
}

/** "Ann Smith" → "AS". */
export function initialsOf(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Author ids, most recent speaker first (no repeats). */
export function recentAuthorIds(messages: Array<{ author: { id: string }; isDeleted?: boolean }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const id = messages[i].author.id;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Recent speakers first, then everyone else in their original (A–Z) order. */
export function rankByRecentActivity<T extends { id: string }>(people: T[], recentIds: string[]): T[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  return people
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ra = rank.has(a.p.id) ? rank.get(a.p.id)! : Infinity;
      const rb = rank.has(b.p.id) ? rank.get(b.p.id)! : Infinity;
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .map((x) => x.p);
}
