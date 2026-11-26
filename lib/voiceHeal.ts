/**
 * Voice self-heal for Ka Link and DM calls.
 *
 * The bug: two people on a call, one suddenly can't hear the other, and the only
 * fix was to leave and come back. Leaving/rejoining re-subscribes the voice and
 * restarts the mic. This watchdog does the same thing, per voice, automatically:
 *
 *  - Listening side: a voice that is unmuted but not subscribed, or subscribed but
 *    no audio packets arriving for ~12s, is re-subscribed (off → on), and its audio
 *    element is re-attached.
 *  - Speaking side: my mic is on, but it has ended or sent no packets for ~12s →
 *    restart the mic track (same device, same mute state).
 *
 * Each voice is healed at most once every 20s, so a phone that is truly offline
 * isn't hammered. Muted voices are never touched, and nobody is ever unmuted.
 */
import {
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
} from 'livekit-client';

import {
  mayHeal,
  nextStall,
  VOICE_HEAL_INTERVAL_MS,
  VOICE_STALL_CHECKS,
  VOICE_UNSUBSCRIBED_CHECKS,
  type StallState,
} from './voiceHealCore';

export * from './voiceHealCore';

export type VoiceHealOptions = {
  /** Make sure this subscribed voice is playing on an audio element. */
  ensureAudio?: (participantIdentity: string, pub: RemoteTrackPublication, track: RemoteTrack) => void;
  /** Activity log hook (what was healed and why). */
  log?: (event: string, detail: Record<string, string | number | undefined>) => void;
  intervalMs?: number;
};

export type VoiceHeal = { check: () => Promise<void>; stop: () => void };

export function startVoiceHeal(room: Room, opts: VoiceHealOptions = {}): VoiceHeal {
  const stalls = new Map<string, StallState>();
  const unsubscribedChecks = new Map<string, number>();
  const healedAt = new Map<string, number>();
  let stopped = false;
  let running = false;

  const log = (event: string, detail: Record<string, string | number | undefined>) => {
    try {
      opts.log?.(event, detail);
    } catch {
      /* logging must never break the call */
    }
  };

  const resubscribe = (pub: RemoteTrackPublication, identity: string, why: string) => {
    log('voice_heal_resubscribe', { who: identity, why });
    try {
      pub.setSubscribed(false);
    } catch {
      /* gone */
    }
    window.setTimeout(() => {
      if (stopped) return;
      try {
        pub.setSubscribed(true);
      } catch {
        /* gone */
      }
    }, 400);
  };

  const checkListening = async (now: number) => {
    const live = new Set<string>();
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        const rp = pub as RemoteTrackPublication;
        if (rp.kind !== Track.Kind.Audio) continue;
        const key = `in:${p.identity}:${rp.trackSid}`;
        live.add(key);
        if (rp.isMuted) {
          stalls.delete(key);
          unsubscribedChecks.delete(key);
          continue;
        }
        if (!rp.isDesired) {
          // A voice we should always hear (audio is never skipped, even with Data Saver).
          try {
            rp.setSubscribed(true);
          } catch {
            /* gone */
          }
          continue;
        }
        const track = rp.track as RemoteAudioTrack | undefined;
        if (!rp.isSubscribed || !track) {
          const n = (unsubscribedChecks.get(key) ?? 0) + 1;
          unsubscribedChecks.set(key, n);
          if (n >= VOICE_UNSUBSCRIBED_CHECKS && mayHeal(healedAt.get(key), now)) {
            healedAt.set(key, now);
            unsubscribedChecks.set(key, 0);
            resubscribe(rp, p.identity, 'not_subscribed');
          }
          continue;
        }
        unsubscribedChecks.delete(key);
        opts.ensureAudio?.(p.identity, rp, track);
        let packets: number | undefined;
        try {
          packets = (await track.getReceiverStats())?.packetsReceived;
        } catch {
          packets = undefined;
        }
        const next = nextStall(stalls.get(key) ?? { last: null, stalls: 0 }, packets);
        stalls.set(key, next);
        if (next.stalls >= VOICE_STALL_CHECKS && mayHeal(healedAt.get(key), now)) {
          healedAt.set(key, now);
          stalls.set(key, { last: null, stalls: 0 });
          resubscribe(rp, p.identity, 'no_packets');
        }
      }
    }
    for (const key of Array.from(stalls.keys())) if (key.startsWith('in:') && !live.has(key)) stalls.delete(key);
    for (const key of Array.from(unsubscribedChecks.keys())) if (!live.has(key)) unsubscribedChecks.delete(key);
  };

  const checkSpeaking = async (now: number) => {
    const key = 'out:mic';
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track as LocalAudioTrack | undefined;
    if (!pub || !track || pub.isMuted) {
      stalls.delete(key);
      return;
    }
    // In the background the browser may pause the mic on purpose; the return handler deals with that.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      stalls.delete(key);
      return;
    }
    const media = track.mediaStreamTrack;
    let why: string | null = null;
    if (!media || media.readyState === 'ended') {
      why = 'mic_ended';
    } else {
      let packets: number | undefined;
      try {
        packets = (await track.getSenderStats())?.packetsSent;
      } catch {
        packets = undefined;
      }
      const next = nextStall(stalls.get(key) ?? { last: null, stalls: 0 }, packets);
      stalls.set(key, next);
      if (next.stalls >= VOICE_STALL_CHECKS) why = 'mic_not_sending';
    }
    if (!why || !mayHeal(healedAt.get(key), now)) return;
    healedAt.set(key, now);
    stalls.set(key, { last: null, stalls: 0 });
    log('voice_heal_mic_restart', { why });
    try {
      await track.restartTrack();
    } catch {
      /* the visibility/return handler shows "tap Unmute" if the mic is really gone */
    }
  };

  const check = async () => {
    if (stopped || running || room.state !== 'connected') return;
    running = true;
    try {
      const now = Date.now();
      await checkListening(now);
      await checkSpeaking(now);
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(() => void check(), opts.intervalMs ?? VOICE_HEAL_INTERVAL_MS);

  const onFailed = () => {
    // A failed subscribe used to leave the voice silent until rejoin. Retry soon.
    window.setTimeout(() => void check(), 1_500);
  };
  const onReconnected = () => {
    stalls.clear();
    unsubscribedChecks.clear();
    window.setTimeout(() => void check(), 1_000);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    room.off(RoomEvent.TrackSubscriptionFailed, onFailed);
    room.off(RoomEvent.Reconnected, onReconnected);
    room.off(RoomEvent.Disconnected, stop);
  };
  room.on(RoomEvent.TrackSubscriptionFailed, onFailed);
  room.on(RoomEvent.Reconnected, onReconnected);
  room.on(RoomEvent.Disconnected, stop);

  return { check, stop };
}
