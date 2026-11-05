/**
 * Instant messages + "typing…" for one room.
 *
 * The Vault pings the room's private live channel (topic from room-info) when a
 * message is sent, gets a photo, or is removed. The ping holds ids only; we then
 * reload messages through the normal access-checked API. People in the room
 * also share "typing…" on the same channel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';

const TYPING_SEND_EVERY_MS = 2500;
const TYPING_SHOW_FOR_MS = 5000;

export type TypingPerson = { id: string; name: string };

/** Pure: who is still typing (newest first), never yourself. */
export function activeTypers(
  map: Map<string, { name: string; until: number }>,
  selfId: string | null | undefined,
  now = Date.now()
): TypingPerson[] {
  const out: Array<TypingPerson & { until: number }> = [];
  for (const [id, v] of map) if (id !== selfId && v.until > now) out.push({ id, name: v.name, until: v.until });
  return out.sort((a, b) => b.until - a.until).map(({ id, name }) => ({ id, name }));
}

/** Pure: "Ann is typing…", "Ann and Paul are typing…", "3 people are typing…". */
export function typingLabel(people: TypingPerson[]): string {
  if (!people.length) return '';
  const first = (n: string) => n.split(/\s+/)[0] || n;
  if (people.length === 1) return `${first(people[0].name)} is typing…`;
  if (people.length === 2) return `${first(people[0].name)} and ${first(people[1].name)} are typing…`;
  return `${people.length} people are typing…`;
}

export function useRoomLive(opts: {
  topic: string | null;
  self: { id: string; name: string } | null;
  onChange: () => void;
  /** Someone opened the room (their read position moved) → refresh ✓✓. */
  onRead?: () => void;
}) {
  const { topic, self } = opts;
  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  const onReadRef = useRef(opts.onRead);
  onReadRef.current = opts.onRead;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);
  const typingMap = useRef(new Map<string, { name: string; until: number }>());
  const [connected, setConnected] = useState(false);
  const [typers, setTypers] = useState<TypingPerson[]>([]);
  const selfId = self?.id ?? null;

  useEffect(() => {
    if (!topic || !isSupabaseConfigured) return;
    const channel = supabase.channel(topic, { config: { broadcast: { self: false } } });
    const refresh = () => onChangeRef.current();
    channel
      .on('broadcast', { event: 'message' }, (msg) => {
        // Their message arrived — they've stopped typing.
        const from = String((msg.payload as any)?.from || '');
        if (from) typingMap.current.delete(from);
        refresh();
      })
      .on('broadcast', { event: 'deleted' }, refresh)
      .on('broadcast', { event: 'read' }, () => onReadRef.current?.())
      .on('broadcast', { event: 'typing' }, (msg) => {
        const p = (msg.payload || {}) as { id?: unknown; name?: unknown };
        const id = String(p.id || '').slice(0, 64);
        const name = String(p.name || 'Someone').slice(0, 60);
        if (!id || id === selfId) return;
        typingMap.current.set(id, { name, until: Date.now() + TYPING_SHOW_FOR_MS });
        setTypers(activeTypers(typingMap.current, selfId));
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        // Catch up on anything sent while we were connecting / reconnecting.
        if (status === 'SUBSCRIBED') refresh();
      });
    channelRef.current = channel;
    const sweep = window.setInterval(() => setTypers(activeTypers(typingMap.current, selfId)), 1000);
    return () => {
      window.clearInterval(sweep);
      channelRef.current = null;
      typingMap.current.clear();
      setTypers([]);
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [topic, selfId]);

  /** Call on every keystroke; sends at most once every 2.5 s. */
  const notifyTyping = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !self) return;
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SEND_EVERY_MS) return;
    lastTypingSent.current = now;
    void ch.send({ type: 'broadcast', event: 'typing', payload: { id: self.id, name: self.name } });
  }, [self]);

  /** After sending, tell the room right away (their screens refresh before the Vault ping). */
  const notifySent = useCallback(
    (messageId: string) => {
      const ch = channelRef.current;
      lastTypingSent.current = 0;
      if (!ch || !self) return;
      void ch.send({ type: 'broadcast', event: 'message', payload: { id: messageId, from: self.id } });
    },
    [self]
  );

  return { connected, typers, typingText: typingLabel(typers), notifyTyping, notifySent };
}
