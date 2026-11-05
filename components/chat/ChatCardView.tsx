import React, { useState } from 'react';
import { CalendarDays, Check, ExternalLink, HandHeart, Loader2, MapPin, Users } from 'lucide-react';
import type { ChatCard, ChatEventCard, ChatServeCard } from '../../lib/communityChatTypes';

const TZ = 'Africa/Kampala';

function whenLabel(iso: string | null, timeLabel?: string | null, endLabel?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ });
  const time = timeLabel || d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return `${day} · ${time}${endLabel ? ` – ${endLabel}` : ''}`;
}

function dateBlock(iso: string | null) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return {
    month: d.toLocaleDateString(undefined, { month: 'short', timeZone: TZ }).toUpperCase(),
    day: d.toLocaleDateString(undefined, { day: 'numeric', timeZone: TZ }),
  };
}

const shell = 'min-w-[240px] sm:min-w-[310px] rounded-xl overflow-hidden bg-white text-[#1A1A1A] border border-gray-200';

const DateTile: React.FC<{ iso: string | null; tone: 'event' | 'serve' }> = ({ iso, tone }) => {
  const b = dateBlock(iso);
  return (
    <div
      className={`shrink-0 w-14 rounded-xl flex flex-col items-center justify-center py-1.5 ${tone === 'event' ? 'bg-burgundy text-white' : 'bg-gold/30 text-burgundy'}`}
      aria-hidden
    >
      {b ? (
        <>
          <span className="text-[11px] font-bold tracking-wider">{b.month}</span>
          <span className="text-2xl font-black leading-none">{b.day}</span>
        </>
      ) : tone === 'event' ? (
        <CalendarDays size={24} />
      ) : (
        <HandHeart size={24} />
      )}
    </div>
  );
};

const EventCardBody: React.FC<{
  card: ChatEventCard;
  onGoing: (card: ChatEventCard, going: boolean) => Promise<void>;
}> = ({ card, onGoing }) => {
  const [busy, setBusy] = useState(false);
  const when = whenLabel(card.startsAt, card.timeLabel, card.endTime);
  const past = card.startsAt ? new Date(card.startsAt).getTime() < Date.now() - 6 * 3600_000 : false;
  const tap = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onGoing(card, !card.going);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={shell}>
      {card.imageUrl ? <img src={card.imageUrl} alt="" className="w-full h-32 object-cover" loading="lazy" /> : null}
      <div className="p-3 space-y-3">
        <div className="flex gap-3">
          <DateTile iso={card.startsAt} tone="event" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-burgundy">Event</p>
            <p className="text-[17px] font-bold leading-snug">{card.title}</p>
            {when ? <p className="text-sm text-gray-600 mt-0.5">{when}</p> : null}
            {card.location ? (
              <p className="text-sm text-gray-600 flex items-center gap-1 mt-0.5">
                <MapPin size={14} className="shrink-0" aria-hidden /> {card.location}
              </p>
            ) : null}
          </div>
        </div>
        {past ? (
          <p className="text-sm font-semibold text-gray-500">This event has passed.</p>
        ) : (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => void tap()}
              disabled={busy}
              aria-pressed={card.going}
              className={`min-h-[52px] rounded-xl text-base font-bold flex items-center justify-center gap-2 border-2 ${
                card.going ? 'bg-gold/25 border-gold text-burgundy' : 'bg-burgundy border-burgundy text-white'
              }`}
            >
              {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : card.going ? <Check size={20} strokeWidth={3} aria-hidden /> : null}
              {card.going ? 'You’re coming' : 'I’ll be there'}
            </button>
            {card.signupUrl ? (
              <a
                href={card.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[48px] rounded-xl border-2 border-burgundy text-burgundy text-base font-bold flex items-center justify-center gap-2"
              >
                Sign up / RSVP <ExternalLink size={16} aria-hidden />
              </a>
            ) : null}
          </div>
        )}
        {card.goingCount > 0 ? (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Users size={13} aria-hidden /> {card.goingCount} {card.goingCount === 1 ? 'person is' : 'people are'} planning to come
          </p>
        ) : null}
      </div>
    </div>
  );
};

const ServeCardBody: React.FC<{
  card: ChatServeCard;
  onServe: (card: ChatServeCard, action: 'signup' | 'cancel') => Promise<void>;
}> = ({ card, onServe }) => {
  const [busy, setBusy] = useState(false);
  const when = whenLabel(card.startsAt, null, card.endsAt ? new Date(card.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : null);
  const full = card.spotsLeft === 0 && !card.mySignup;
  const act = async (action: 'signup' | 'cancel') => {
    if (busy) return;
    if (action === 'cancel' && !window.confirm('Cancel your sign-up for this?')) return;
    setBusy(true);
    try {
      await onServe(card, action);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={shell}>
      <div className="p-3 space-y-3">
        <div className="flex gap-3">
          <DateTile iso={card.startsAt} tone="serve" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-burgundy">Volunteers needed</p>
            <p className="text-[17px] font-bold leading-snug">{card.title}</p>
            {card.roleLabel ? <p className="text-sm text-gray-700">{card.roleLabel}</p> : null}
            {when ? <p className="text-sm text-gray-600 mt-0.5">{when}</p> : null}
            {card.location ? (
              <p className="text-sm text-gray-600 flex items-center gap-1 mt-0.5">
                <MapPin size={14} className="shrink-0" aria-hidden /> {card.location}
              </p>
            ) : null}
          </div>
        </div>
        {card.description ? <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">{card.description}</p> : null}
        {card.spotsLeft != null ? (
          <p className={`text-sm font-bold ${card.spotsLeft === 0 ? 'text-gray-500' : 'text-burgundy'}`}>
            {card.spotsLeft === 0 ? 'All spots are filled' : `${card.spotsLeft} ${card.spotsLeft === 1 ? 'spot' : 'spots'} left`}
          </p>
        ) : null}
        {!card.open ? (
          <p className="text-sm font-semibold text-gray-500">Sign-ups are closed.</p>
        ) : card.mySignup ? (
          <div className="grid gap-2">
            <p className="min-h-[52px] rounded-xl bg-gold/25 border-2 border-gold text-burgundy text-base font-bold flex items-center justify-center gap-2">
              <Check size={20} strokeWidth={3} aria-hidden />
              {card.mySignup === 'pending' ? 'Signed up · waiting for a leader' : 'You’re signed up'}
            </p>
            <button
              type="button"
              onClick={() => void act('cancel')}
              disabled={busy}
              className="min-h-[44px] text-sm font-bold text-burgundy underline underline-offset-2"
            >
              {busy ? 'Saving…' : 'Can’t make it? Cancel'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void act('signup')}
            disabled={busy || full}
            className="w-full min-h-[52px] rounded-xl bg-burgundy text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <HandHeart size={20} aria-hidden />}
            {full ? 'Full' : 'Sign me up'}
          </button>
        )}
        {card.requiresApproval && !card.mySignup && card.open ? (
          <p className="text-xs text-gray-500">A leader confirms each sign-up.</p>
        ) : null}
      </div>
    </div>
  );
};

/** An event or Serve card inside a chat bubble. */
export const ChatCardView: React.FC<{
  card: ChatCard;
  onGoing: (messageId: string, card: ChatEventCard, going: boolean) => Promise<void>;
  onServe: (messageId: string, card: ChatServeCard, action: 'signup' | 'cancel') => Promise<void>;
}> = ({ card, onGoing, onServe }) => {
  if (card.missing) {
    return (
      <p className="text-sm italic opacity-80">
        {card.kind === 'event' ? 'This event is no longer on the calendar.' : 'This Serve need was removed.'}
      </p>
    );
  }
  return (
    <div onTouchStart={(e) => e.stopPropagation()}>
      {card.kind === 'event' && card.event ? (
        <EventCardBody card={card.event} onGoing={(c, g) => onGoing(card.messageId, c, g)} />
      ) : card.kind === 'serve' && card.serve ? (
        <ServeCardBody card={card.serve} onServe={(c, a) => onServe(card.messageId, c, a)} />
      ) : null}
    </div>
  );
};
