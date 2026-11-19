import React, { useEffect, useRef, useState } from 'react';
import { CornerUpLeft, Loader2, Send, X } from 'lucide-react';
import {
  HUDDLE_CHAT_MAX_LENGTH,
  normalizeHuddleChatReply,
  type HuddleChatMessage,
  type HuddleChatReplyRef,
} from '../../lib/huddleChat';

type Props = {
  messages: HuddleChatMessage[];
  onSend: (text: string, reply?: HuddleChatReplyRef | null) => Promise<void> | void;
  sending?: boolean;
};

/**
 * Live Ka Link chat. Tap "Reply" on any message to answer it: your message
 * carries a short quote of the one you answered (tap the quote to jump to it).
 */
export const HuddleChatPanel: React.FC<Props> = ({
  messages,
  onSend,
  sending = false,
}) => {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<HuddleChatMessage | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = sending;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const startReply = (m: HuddleChatMessage) => {
    setReplyTo(m);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  };

  const jumpTo = (id: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1400);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const reply = replyTo
      ? normalizeHuddleChatReply({ id: replyTo.id, name: replyTo.isLocal ? 'You' : replyTo.senderName, text: replyTo.text })
      : null;
    setDraft('');
    setReplyTo(null);
    await onSend(text, reply);
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="huddle-chat-panel">
      <div className="px-4 pt-1 pb-2 border-b border-white/10 shrink-0">
        <p className="text-xs font-black uppercase tracking-widest text-gold">Chat</p>
        <p className="text-xs text-white/50 mt-0.5">
          Live Ka Link only — messages disappear when you leave. Tap Reply to answer a message.
        </p>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <p className="text-sm text-white/40 text-center py-8">
            No messages yet. Say hello to the Ka Link.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              data-chat-id={m.id}
              className={`group max-w-[92%] ${m.isLocal ? 'ml-auto' : 'mr-auto'}`}
            >
              <div
                className={`rounded-2xl px-3 py-2 transition-shadow ${
                  m.isLocal ? 'bg-burgundy/80 border border-burgundy' : 'bg-white/5 border border-white/10'
                } ${flashId === m.id ? 'ring-2 ring-gold' : ''}`}
              >
                <p className="text-xs font-bold text-gold/90 mb-0.5">
                  {m.isLocal ? 'You' : m.senderName}
                  {m.showModeratorBadge ? ' · Mod' : ''}
                </p>
                {m.reply ? (
                  <button
                    type="button"
                    onClick={() => jumpTo(m.reply!.id)}
                    className="mb-1.5 block w-full rounded-lg border-l-2 border-gold bg-black/20 px-2 py-1 text-left"
                    aria-label={`Replying to ${m.reply.name}: ${m.reply.text}. Show that message`}
                  >
                    <span className="block text-[11px] font-bold text-gold/90">{m.reply.name}</span>
                    <span className="block truncate text-xs text-white/70">{m.reply.text}</span>
                  </button>
                ) : null}
                <p className="text-sm text-white leading-snug whitespace-pre-wrap break-words">
                  {m.text}
                </p>
              </div>
              <div className={`mt-0.5 flex ${m.isLocal ? 'justify-end' : 'justify-start'}`}>
                <button
                  type="button"
                  onClick={() => startReply(m)}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-full px-2 text-[11px] font-bold text-white/55 hover:text-gold focus-visible:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                  aria-label={`Reply to ${m.isLocal ? 'your message' : m.senderName}`}
                  data-testid="huddle-chat-reply"
                >
                  <CornerUpLeft size={13} aria-hidden /> Reply
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {replyTo ? (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-xl border-l-2 border-gold bg-white/5 px-3 py-2" data-testid="huddle-chat-replying">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-gold">Replying to {replyTo.isLocal ? 'yourself' : replyTo.senderName}</p>
            <p className="truncate text-xs text-white/70">{replyTo.text}</p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 hover:text-white"
            aria-label="Cancel reply"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}

      <form
        onSubmit={(e) => void submit(e)}
        className="px-3 pt-2 pb-1 shrink-0 border-t border-white/10 flex items-end gap-2"
      >
        <label className="sr-only" htmlFor="huddle-chat-input">
          Message
        </label>
        <textarea
          id="huddle-chat-input"
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={HUDDLE_CHAT_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && replyTo) setReplyTo(null);
          }}
          placeholder={replyTo ? 'Write your reply…' : 'Message the Ka Link…'}
          className="flex-1 min-h-[44px] max-h-24 resize-none rounded-xl bg-white/10 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-gold/40"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="min-h-[44px] min-w-[44px] rounded-xl bg-gold text-burgundy flex items-center justify-center disabled:opacity-40"
          aria-label="Send message"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
};
