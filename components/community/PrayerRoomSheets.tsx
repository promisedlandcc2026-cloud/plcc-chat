import React, { useState } from 'react';
import { Check, HandHeart, Loader2, ShieldCheck, X } from 'lucide-react';
import { submitPrayerRequest, type PrayerRequestShare } from '../../lib/communityChatClient';

const CATEGORIES = ['Healing', 'Guidance', 'Praise Report', 'Family', 'Financial'] as const;

const SHARE_OPTIONS: Array<[PrayerRequestShare, string, string]> = [
  ['wall', '🙏 Prayer Wall + Intercessors', 'The church stands in agreement, and the Intercessors pray over it.'],
  ['intercessors', '🤝 Intercessors only', 'Private. Only the Intercessors and the Pastor see it.'],
  ['pastor', '🔒 Pastor only', 'Only the Pastor sees it.'],
];

function Sheet({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="pr-sheet-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="pr-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-lg font-extrabold">
            <span className="pr-info-icon">{icon}</span>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-black/5 flex items-center justify-center">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Send a prayer request to PLCC Canaan's Prayer Wall without leaving the huddle. */
export function PrayerRequestSheet({ onClose, roomName }: { onClose: () => void; roomName?: string }) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<string>('Healing');
  const [shareWith, setShareWith] = useState<PrayerRequestShare>('wall');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const send = async () => {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await submitPrayerRequest({ content: text, category, shareWith });
      setSent(
        result.status === 'Published'
          ? 'Your prayer request is on the Prayer Wall.'
          : result.status === 'Confidential'
            ? result.shareWith === 'intercessors'
              ? 'Sent privately to the Intercessors.'
              : 'Sent privately to the Pastor.'
            : 'Sent. A leader will review it shortly.'
      );
      setContent('');
    } catch (err: any) {
      setError(err?.message || 'Could not send your prayer request.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet title="Prayer request" icon={<HandHeart size={15} aria-hidden />} onClose={onClose}>
      {sent ? (
        <div className="mt-5 space-y-4 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#1f8a4c] text-white">
            <Check size={26} aria-hidden />
          </span>
          <p className="text-base font-bold">{sent}</p>
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setSent(null)} className="flex-1 min-h-[48px] rounded-2xl border border-[#eadfca] font-bold">
              Send another
            </button>
            <button type="button" onClick={onClose} className="flex-1 min-h-[48px] rounded-2xl bg-[#0f3d2c] text-white font-bold">
              Back to prayer
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-[#3a4640]">
            The prayer keeps playing while you write{roomName ? ` in ${roomName}` : ''}.
          </p>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-widest text-[#4a5a52]">What can we pray for?</span>
            <textarea
              rows={4}
              autoFocus
              maxLength={2000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="mt-1.5 w-full resize-none rounded-2xl border border-[#eadfca] bg-[#f6f1e6] px-4 py-3 text-base outline-none focus:border-[#d9b45e]"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-widest text-[#4a5a52]">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 min-h-[48px] w-full rounded-2xl border border-[#eadfca] bg-[#f6f1e6] px-4 text-base font-semibold"
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div role="radiogroup" aria-label="Who should pray" className="space-y-2">
            <span className="text-xs font-black uppercase tracking-widest text-[#4a5a52]">Who should pray</span>
            {SHARE_OPTIONS.map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 ${
                  shareWith === value ? 'border-[#0f3d2c] bg-[#0f3d2c]/5' : 'border-[#eadfca] bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="huddle-prayer-share"
                  checked={shareWith === value}
                  onChange={() => setShareWith(value)}
                  className="mt-1 accent-[#0f3d2c]"
                />
                <span>
                  <span className="block text-sm font-extrabold">{label}</span>
                  <span className="block text-xs text-[#4a5a52]">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {error ? <p className="text-sm font-semibold text-[#9c2a23]">{error}</p> : null}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!content.trim() || sending}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0f3d2c] text-base font-bold text-white disabled:opacity-50"
          >
            {sending ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
            {sending ? 'Sending…' : 'Send prayer request'}
          </button>
        </div>
      )}
    </Sheet>
  );
}

export function GuidelinesSheet({ onClose, overflow = false }: { onClose: () => void; overflow?: boolean }) {
  const rules = [
    'This is an audio prayer room. Join with headphones if you can.',
    'Stay muted unless you are praying aloud.',
    'Raise your hand to ask to pray. A moderator will invite you.',
    'Keep every prayer respectful, focused and kind.',
    'Never share private details about other people.',
    overflow
      ? 'This overflow room opens when the main Jordan room is full.'
      : 'When this room is full, PLCC Sanctum opens an overflow room.',
    'Moderators may mute or remove anyone to keep the room safe.',
  ];
  return (
    <Sheet title="Prayer room guidelines" icon={<ShieldCheck size={15} aria-hidden />} onClose={onClose}>
      <ol className="mt-4 space-y-3">
        {rules.map((rule, n) => (
          <li key={rule} className="flex gap-3 text-[15px] leading-snug">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f1d58a] text-xs font-black">{n + 1}</span>
            {rule}
          </li>
        ))}
      </ol>
      <button type="button" onClick={onClose} className="mt-5 min-h-[48px] w-full rounded-2xl bg-[#0f3d2c] font-bold text-white">
        I understand
      </button>
    </Sheet>
  );
}
