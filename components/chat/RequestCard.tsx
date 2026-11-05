import React, { useEffect, useState } from 'react';
import { Car, Check, ChevronDown, Hand, HeartHandshake, Home, Loader2, Search, Soup, UserPlus, Users, X } from 'lucide-react';
import type { ChatMentionPerson, ChatRequest, ChatRequestAction, ChatRequestCategory } from '../../lib/communityChatTypes';
import { searchRoomMentions } from '../../lib/communityChatClient';
import { Portal } from './Portal';

const ICONS: Record<ChatRequestCategory, typeof Car> = { ride: Car, visit: Users, meal: Soup, errand: Home, other: Hand };

const ACTION_TEXT: Record<string, string> = {
  created: 'asked for help',
  volunteer: 'offered to help',
  assign: 'assigned',
  unassign: 'stepped back',
  done: 'marked it done',
  reopen: 'reopened it',
  cancel: 'cancelled it',
  note: 'added an update',
};

function shortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function requestStatusText(r: ChatRequest): string {
  if (r.status === 'done') return r.helper ? `Done · helped by ${r.helper.name}` : 'Done';
  if (r.status === 'cancelled') return 'Cancelled';
  if (r.helper) return r.isHelper ? 'You’re helping' : `${r.helper.name} is helping`;
  return 'Needs a helper';
}

/** Leaders: pick someone in this chat to help. */
const AssignSheet: React.FC<{
  channelId: string;
  onPick: (p: ChatMentionPerson) => Promise<void>;
  onCancel: () => void;
}> = ({ channelId, onPick, onCancel }) => {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<ChatMentionPerson[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      searchRoomMentions(channelId, q.trim())
        .then((list) => alive && setPeople(list.filter((p) => !p.everyone).slice(0, 30)))
        .catch(() => alive && setPeople([]));
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [channelId, q]);
  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={onCancel}>
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Assign a helper"
          className="w-full max-w-[500px] max-h-[85vh] flex flex-col rounded-t-3xl lg:rounded-3xl bg-white shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] gap-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#1A1A1A]">Who will help?</h2>
            <button type="button" onClick={onCancel} className="min-h-[44px] min-w-[44px] rounded-full bg-gray-100 flex items-center justify-center" aria-label="Cancel">
              <X size={20} />
            </button>
          </div>
          <label className="relative block">
            <span className="sr-only">Search people in this chat</span>
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people in this chat"
              className="w-full min-h-[52px] rounded-2xl border border-gray-200 pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
              autoFocus
            />
          </label>
          <ul className="flex-1 overflow-y-auto space-y-1.5">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    setBusy(p.id);
                    try {
                      await onPick(p);
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="w-full min-h-[56px] rounded-2xl px-4 flex items-center justify-between gap-3 text-left bg-eggshell active:bg-gold/20"
                >
                  <span className="text-[15px] font-bold text-[#1A1A1A]">{p.name}</span>
                  {busy === p.id ? <Loader2 size={18} className="animate-spin text-burgundy" aria-hidden /> : <UserPlus size={18} className="text-burgundy" aria-hidden />}
                </button>
              </li>
            ))}
            {!people.length ? <li className="text-sm text-gray-500 py-6 text-center">No one found.</li> : null}
          </ul>
        </div>
      </div>
    </Portal>
  );
};

/** A help request inside a chat bubble, with its status, helper and actions. */
export const RequestCard: React.FC<{
  request: ChatRequest;
  onAction: (r: ChatRequest, action: ChatRequestAction, extra?: { assigneeId?: string; note?: string }) => Promise<void>;
}> = ({ request: r, onAction }) => {
  const [busy, setBusy] = useState<ChatRequestAction | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const Icon = ICONS[r.category] || HeartHandshake;
  const closed = r.status === 'done' || r.status === 'cancelled';

  const run = async (action: ChatRequestAction, extra?: { assigneeId?: string; note?: string }, confirmText?: string) => {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    try {
      await onAction(r, action, extra);
    } finally {
      setBusy(null);
    }
  };

  const pill =
    r.status === 'done'
      ? 'bg-green-100 text-green-800'
      : r.status === 'cancelled'
        ? 'bg-gray-100 text-gray-600'
        : r.helper
          ? 'bg-gold/30 text-burgundy'
          : 'bg-burgundy text-white';

  const big = 'min-h-[52px] rounded-xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50';
  const small = 'min-h-[40px] px-3 rounded-lg text-sm font-bold text-burgundy border border-burgundy/30 bg-white';

  return (
    <div className="min-w-[240px] sm:min-w-[310px] rounded-xl bg-white text-[#1A1A1A] border border-gray-200 p-3 space-y-3" onTouchStart={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 h-11 w-11 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center" aria-hidden>
          <Icon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-burgundy">Request · {r.categoryLabel}</p>
          <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">{r.details}</p>
          <p className="text-xs text-gray-500 mt-0.5">Asked by {r.isMine ? 'you' : r.askedBy.name}</p>
        </div>
      </div>

      <p className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${pill}`}>
        {r.status === 'done' ? <Check size={15} strokeWidth={3} aria-hidden /> : null}
        {requestStatusText(r)}
      </p>

      <div className="grid gap-2">
        {r.can.volunteer ? (
          <button type="button" onClick={() => void run('volunteer')} disabled={Boolean(busy)} className={`${big} bg-burgundy text-white`}>
            {busy === 'volunteer' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <HeartHandshake size={20} aria-hidden />}
            I can help
          </button>
        ) : null}
        {r.can.done && (r.isHelper || r.isMine || !r.can.volunteer) ? (
          <button
            type="button"
            onClick={() => void run('done', undefined, 'Mark this request as done?')}
            disabled={Boolean(busy)}
            className={`${big} ${r.isHelper ? 'bg-burgundy text-white' : 'border-2 border-burgundy text-burgundy bg-white'}`}
          >
            {busy === 'done' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Check size={20} aria-hidden />}
            Mark done
          </button>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {r.can.assign ? (
            <button type="button" onClick={() => setAssignOpen(true)} disabled={Boolean(busy)} className={small}>
              {r.helper ? 'Reassign' : 'Assign someone'}
            </button>
          ) : null}
          {r.can.note ? (
            <button type="button" onClick={() => setNoteOpen((v) => !v)} disabled={Boolean(busy)} className={small}>
              Add update
            </button>
          ) : null}
          {r.can.unassign ? (
            <button type="button" onClick={() => void run('unassign', undefined, r.isHelper ? 'Step back from helping?' : 'Remove the helper?')} disabled={Boolean(busy)} className={small}>
              {r.isHelper ? 'I can’t help after all' : 'Remove helper'}
            </button>
          ) : null}
          {r.can.cancel ? (
            <button type="button" onClick={() => void run('cancel', undefined, 'Cancel this request?')} disabled={Boolean(busy)} className={small}>
              Cancel request
            </button>
          ) : null}
          {closed && r.can.reopen ? (
            <button type="button" onClick={() => void run('reopen')} disabled={Boolean(busy)} className={small}>
              Reopen
            </button>
          ) : null}
        </div>
      </div>

      {noteOpen ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim()) return;
            await run('note', { note: note.trim() });
            setNote('');
            setNoteOpen(false);
          }}
        >
          <label className="sr-only" htmlFor={`note-${r.id}`}>Update</label>
          <input
            id={`note-${r.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. I'll pick you up at 9:30"
            className="flex-1 min-h-[48px] rounded-xl border border-gray-200 px-3 text-base focus:outline-none focus:ring-2 focus:ring-burgundy/30"
            autoFocus
          />
          <button type="submit" disabled={!note.trim() || Boolean(busy)} className="min-h-[48px] px-4 rounded-xl bg-burgundy text-white font-bold disabled:opacity-40">
            {busy === 'note' ? <Loader2 size={18} className="animate-spin" /> : 'Save'}
          </button>
        </form>
      ) : null}

      {r.history.length > 1 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="text-xs font-bold text-gray-600 inline-flex items-center gap-1 min-h-[32px]"
          >
            <ChevronDown size={14} className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} aria-hidden />
            {showHistory ? 'Hide history' : `History (${r.history.length})`}
          </button>
          {showHistory ? (
            <ol className="mt-1 space-y-1.5 border-l-2 border-gold/50 pl-3">
              {r.history.map((h, i) => (
                <li key={i} className="text-xs text-gray-700">
                  <span className="font-bold">{h.by}</span> {ACTION_TEXT[h.action] || h.action}
                  {h.action === 'assign' && h.to ? ` ${h.to}` : ''}
                  {h.note ? <span className="block text-gray-600">“{h.note}”</span> : null}
                  <span className="block text-gray-400">{shortTime(h.at)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {assignOpen && r.channelId ? (
        <AssignSheet
          channelId={r.channelId}
          onCancel={() => setAssignOpen(false)}
          onPick={async (p) => {
            await run('assign', { assigneeId: p.id });
            setAssignOpen(false);
          }}
        />
      ) : null}
    </div>
  );
};
