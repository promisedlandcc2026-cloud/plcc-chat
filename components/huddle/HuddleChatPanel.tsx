import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import {
  HUDDLE_CHAT_MAX_LENGTH,
  type HuddleChatMessage,
} from '../../lib/huddleChat';

type Props = {
  messages: HuddleChatMessage[];
  onSend: (text: string) => Promise<void> | void;
  sending?: boolean;
};

export const HuddleChatPanel: React.FC<Props> = ({
  messages,
  onSend,
  sending = false,
}) => {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const busy = sending;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    await onSend(text);
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="huddle-chat-panel">
      <div className="px-4 pt-1 pb-2 border-b border-white/10 shrink-0">
        <p className="text-xs font-black uppercase tracking-widest text-gold">Chat</p>
        <p className="text-xs text-white/50 mt-0.5">
          Live huddle only — messages disappear when you leave.
        </p>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <p className="text-sm text-white/40 text-center py-8">
            No messages yet. Say hello to the huddle.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-2xl px-3 py-2 max-w-[92%] ${
                m.isLocal
                  ? 'ml-auto bg-burgundy/80 border border-burgundy'
                  : 'mr-auto bg-white/5 border border-white/10'
              }`}
            >
              <p className="text-xs font-bold text-gold/90 mb-0.5">
                {m.isLocal ? 'You' : m.senderName}
                {m.showModeratorBadge ? ' · Mod' : ''}
              </p>
              <p className="text-sm text-white leading-snug whitespace-pre-wrap break-words">
                {m.text}
              </p>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => void submit(e)}
        className="px-3 pt-2 pb-1 shrink-0 border-t border-white/10 flex items-end gap-2"
      >
        <label className="sr-only" htmlFor="huddle-chat-input">
          Message
        </label>
        <textarea
          id="huddle-chat-input"
          rows={1}
          value={draft}
          maxLength={HUDDLE_CHAT_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the huddle…"
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
