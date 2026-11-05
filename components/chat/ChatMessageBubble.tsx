import React, { useRef, useState } from 'react';
import { Check, CheckCheck, ChevronDown, CornerUpLeft } from 'lucide-react';
import type { ChatCard, ChatEventCard, ChatPoll, ChatReader, ChatRequest, ChatRequestAction, ChatServeCard, CommunityChatMessage } from '../../lib/communityChatTypes';
import { RequestCard } from './RequestCard';
import { ChatCardView } from './ChatCardView';
import { PollCard } from './PollCard';
import { ChatAttachments } from './ChatAttachments';
import { visibleCaption } from '../../lib/chatMedia';
import { seenBy, seenLabel, splitRich, tickState } from '../../lib/chatMessageUtils';

const SWIPE_REPLY_PX = 60;
const LONG_PRESS_MS = 450;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const MessageText: React.FC<{ text: string; mine: boolean }> = ({ text, mine }) => (
  <p className={`text-[15px] leading-relaxed whitespace-pre-wrap break-words ${mine ? '' : 'text-[#1A1A1A]'}`}>
    {splitRich(text).map((part, i) =>
      part.kind === 'mention' ? (
        <span key={i} className={`font-bold ${mine ? 'text-gold-light' : 'text-burgundy'}`}>
          {part.text}
        </span>
      ) : part.kind === 'link' ? (
        <a
          key={i}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
          className={`underline underline-offset-2 break-all font-semibold ${mine ? 'text-gold-light' : 'text-burgundy'}`}
        >
          {part.text}
        </a>
      ) : (
        <React.Fragment key={i}>{part.text}</React.Fragment>
      )
    )}
  </p>
);

/**
 * One message: quote, media, text with @mentions, "edited", reactions, read ticks.
 * Touch: swipe right to reply, press and hold for options. Mouse: hover ⌄ or right-click.
 */
export const ChatMessageBubble: React.FC<{
  message: CommunityChatMessage;
  selfId: string;
  isDm: boolean;
  readers: ChatReader[];
  highlighted?: boolean;
  onReply: (m: CommunityChatMessage) => void;
  onOpenActions: (m: CommunityChatMessage) => void;
  onToggleReaction: (m: CommunityChatMessage, emoji: string) => void;
  onJumpTo: (messageId: string) => void;
  /** The poll on this message, if it has one. */
  poll?: ChatPoll | null;
  onPollVote?: (poll: ChatPoll, optionIds: string[]) => Promise<void>;
  onPollClose?: (poll: ChatPoll) => Promise<void>;
  /** Room leaders may close anyone's poll. */
  canCloseAnyPoll?: boolean;
  /** Event / Serve card shared in this message. */
  card?: ChatCard | null;
  onCardGoing?: (messageId: string, card: ChatEventCard, going: boolean) => Promise<void>;
  onCardServe?: (messageId: string, card: ChatServeCard, action: 'signup' | 'cancel') => Promise<void>;
  /** Help request on this message. */
  request?: ChatRequest | null;
  onRequestAction?: (r: ChatRequest, action: ChatRequestAction, extra?: { assigneeId?: string; note?: string }) => Promise<void>;
}> = ({ message: msg, selfId, isDm, readers, highlighted, onReply, onOpenActions, onToggleReaction, onJumpTo, poll, onPollVote, onPollClose, canCloseAnyPoll, card, onCardGoing, onCardServe, request, onRequestAction }) => {
  const mine = Boolean(selfId && msg.author.id === selfId);
  const [dx, setDx] = useState(0);
  const [showSeen, setShowSeen] = useState(false);
  const touch = useRef<{ x: number; y: number; timer: number | null; moved: boolean } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (msg.isDeleted) return;
    const t = e.touches[0];
    const timer = window.setTimeout(() => {
      if (touch.current && !touch.current.moved) {
        touch.current.timer = null;
        navigator.vibrate?.(15);
        onOpenActions(msg);
      }
    }, LONG_PRESS_MS);
    touch.current = { x: t.clientX, y: t.clientY, timer, moved: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current;
    if (!s) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x;
    const my = t.clientY - s.y;
    if (Math.abs(mx) > 8 || Math.abs(my) > 8) {
      s.moved = true;
      if (s.timer) {
        window.clearTimeout(s.timer);
        s.timer = null;
      }
    }
    if (mx > 0 && Math.abs(mx) > Math.abs(my)) setDx(Math.min(mx, 90));
  };
  const onTouchEnd = () => {
    const s = touch.current;
    if (s?.timer) window.clearTimeout(s.timer);
    if (dx >= SWIPE_REPLY_PX && !msg.isDeleted) {
      navigator.vibrate?.(10);
      onReply(msg);
    }
    touch.current = null;
    setDx(0);
  };

  const text = msg.isDeleted ? 'This message was removed' : visibleCaption(msg.content, msg.attachments);
  const seen = mine && !msg.isDeleted ? seenBy(msg, readers) : [];
  const reactions = msg.reactions || [];

  return (
    <article
      id={`msg-${msg.id}`}
      className={`group relative w-fit min-w-[140px] max-w-[88%] lg:max-w-[70%] ${mine ? 'ml-auto' : 'mr-auto'}`}
      onContextMenu={(e) => {
        if (msg.isDeleted) return;
        e.preventDefault();
        onOpenActions(msg);
      }}
    >
      {dx > 10 ? (
        <CornerUpLeft
          size={20}
          className={`absolute top-1/2 -translate-y-1/2 -left-7 text-burgundy transition-opacity ${dx >= SWIPE_REPLY_PX ? 'opacity-100' : 'opacity-40'}`}
          aria-hidden
        />
      ) : null}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        className={`relative rounded-2xl px-4 py-3 transition-[box-shadow,transform] select-none lg:select-text ${
          mine ? 'bg-burgundy text-white' : 'bg-white border border-gray-100 shadow-sm'
        } ${highlighted ? 'ring-4 ring-gold/70' : ''} ${msg.isDeleted ? 'opacity-70' : ''}`}
      >
        {!msg.isDeleted ? (
          <button
            type="button"
            onClick={() => onOpenActions(msg)}
            className={`hidden lg:flex absolute top-1.5 right-1.5 h-7 w-7 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 ${
              mine ? 'bg-burgundy-dark text-white' : 'bg-gray-100 text-gray-600'
            }`}
            aria-label="Message options"
          >
            <ChevronDown size={16} />
          </button>
        ) : null}

        {!mine || !isDm ? (
          <p className={`text-xs font-bold mb-1 pr-6 ${mine ? 'text-white/75' : 'text-burgundy'}`}>
            {mine ? 'You' : msg.author.name}
          </p>
        ) : null}

        {msg.parent ? (
          <button
            type="button"
            onClick={() => msg.parent && !msg.parent.isDeleted && onJumpTo(msg.parent.id)}
            className={`block w-full text-left text-xs mb-2 border-l-4 rounded-md px-2 py-1.5 ${
              mine ? 'border-gold bg-white/10 text-white/85' : 'border-burgundy bg-burgundy/5 text-gray-600'
            }`}
          >
            <span className="block font-bold">{msg.parent.isDeleted ? 'Removed message' : msg.parent.name}</span>
            {!msg.parent.isDeleted && msg.parent.content ? (
              <span className="block truncate">{msg.parent.content}</span>
            ) : null}
          </button>
        ) : null}

        {!msg.isDeleted && msg.attachments?.length ? <ChatAttachments attachments={msg.attachments} mine={mine} /> : null}

        {request && !msg.isDeleted && onRequestAction ? (
          <RequestCard request={request} onAction={onRequestAction} />
        ) : card && !msg.isDeleted && onCardGoing && onCardServe ? (
          <>
            <ChatCardView card={card} onGoing={onCardGoing} onServe={onCardServe} />
            {text.includes('\n') ? <div className="mt-2"><MessageText text={text.slice(text.indexOf('\n') + 1)} mine={mine} /></div> : null}
          </>
        ) : poll && !msg.isDeleted && onPollVote && onPollClose ? (
          <PollCard poll={poll} mine={mine} canClose={poll.isMine || Boolean(canCloseAnyPoll)} onVote={onPollVote} onClose={onPollClose} />
        ) : text ? (
          msg.isDeleted ? (
            <p className="text-sm italic">{text}</p>
          ) : (
            <MessageText text={text} mine={mine} />
          )
        ) : null}

        <div className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${mine ? 'text-white/70' : 'text-gray-500'}`}>
          {msg.editedAt && !msg.isDeleted ? <span>edited ·</span> : null}
          <time dateTime={msg.createdAt}>{formatTime(msg.createdAt)}</time>
          {mine && !msg.isDeleted ? (
            <button
              type="button"
              onClick={() => setShowSeen((v) => !v)}
              className="inline-flex items-center"
              aria-label={seenLabel(seen, isDm)}
              title={seenLabel(seen, isDm)}
            >
              {tickState(seen) === 'seen' ? (
                <CheckCheck size={15} className="text-gold" aria-hidden />
              ) : (
                <Check size={15} aria-hidden />
              )}
            </button>
          ) : null}
        </div>
        {showSeen && mine ? <p className="text-[11px] text-white/80 text-right">{seenLabel(seen, isDm)}</p> : null}
      </div>

      {reactions.length ? (
        <div className={`-mt-1.5 flex flex-wrap gap-1 ${mine ? 'justify-end pr-2' : 'pl-2'}`}>
          {reactions.map((r) => {
            const mineReacted = r.userIds.includes(selfId);
            return (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onToggleReaction(msg, r.emoji)}
                className={`relative z-[1] min-h-[30px] px-2 rounded-full border text-sm shadow-sm flex items-center gap-1 ${
                  mineReacted ? 'bg-gold/25 border-gold' : 'bg-white border-gray-200'
                }`}
                aria-pressed={mineReacted}
                aria-label={`${r.emoji} ${r.userIds.length}${mineReacted ? ', including you' : ''}`}
              >
                <span>{r.emoji}</span>
                {r.userIds.length > 1 ? <span className="text-xs font-bold text-gray-700">{r.userIds.length}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
};
