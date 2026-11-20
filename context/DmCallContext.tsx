/**
 * Private calls in direct messages (WhatsApp-style audio / video), for every member.
 *
 * Lives above the routes like the prayer-room call, so moving around the app never
 * hangs up. It also listens for incoming calls on the member's private call topic
 * and shows the ringing screen anywhere in the app.
 *
 * One call at a time: a second incoming call while busy is declined automatically,
 * and a call can't start while you are in a prayer room (leave it first).
 */
import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { LocalVideoTrack, Room, Track } from 'livekit-client';
import { useAuth } from './AuthContext';
import { useActiveKaLink } from './ActiveKaLinkContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  DmCallError,
  declineDmCall,
  endDmCall,
  fetchCallInbox,
  fetchDmCallStatus,
  fetchPendingCall,
  inboxRetryDelayMs,
  joinDmCall,
  ringDmCall,
  type CallPhase,
  type DmCallPass,
} from '../lib/dmCall';
import { startRingback, startRingtone, type CallTone } from '../lib/callTone';
import { setCallActive } from '../lib/staleBuild';
import { reportIssue } from '../lib/issueReport';

const DmCallScreen = lazy(() => import('../components/call/DmCallScreen').then((m) => ({ default: m.DmCallScreen })));
const CallPip = lazy(() => import('../components/call/CallPip').then((m) => ({ default: m.CallPip })));

export type DmCallState = {
  phase: CallPhase;
  channelId: string | null;
  partnerName: string;
  video: boolean;
  /** I started it (vs. answering). */
  outgoing: boolean;
  connectedAt: number | null;
  endedReason: string | null;
  micOn: boolean;
  cameraOn: boolean;
  facing: 'user' | 'environment';
  minimized: boolean;
  remoteVideo: Track | null;
  localVideo: Track | null;
  remoteCameraOn: boolean;
  notice: string | null;
};

const IDLE: DmCallState = {
  phase: 'idle',
  channelId: null,
  partnerName: '',
  video: false,
  outgoing: false,
  connectedAt: null,
  endedReason: null,
  micOn: true,
  cameraOn: false,
  facing: 'user',
  minimized: false,
  remoteVideo: null,
  localVideo: null,
  remoteCameraOn: false,
  notice: null,
};

type DmCallContextValue = {
  call: DmCallState;
  inPrayerRoom: boolean;
  startCall: (opts: { channelId: string; partnerName: string; video: boolean }) => Promise<void>;
  answer: () => Promise<void>;
  decline: () => void;
  hangUp: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  flipCamera: () => void;
  setMinimized: (on: boolean) => void;
  dismiss: () => void;
  /** Opened from a call alert: show the ringing screen if this chat's call is still ringing. */
  checkIncoming: (channelId: string, partnerName?: string) => Promise<void>;
  /** Where remote audio elements go. */
  audioSinkRef: React.RefObject<HTMLDivElement>;
};

const Ctx = createContext<DmCallContextValue | null>(null);

export function useDmCall(): DmCallContextValue | null {
  return useContext(Ctx);
}

export const DmCallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, identity, memberAccessState } = useAuth();
  const selfId = identity?.id || user?.id || null;
  const { active: activeKaLink } = useActiveKaLink();
  const inPrayerRoom = Boolean(activeKaLink);
  const [call, setCall] = useState<DmCallState>(IDLE);
  const callRef = useRef(call);
  callRef.current = call;
  const roomRef = useRef<Room | null>(null);
  const toneRef = useRef<CallTone | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const ringSecondsRef = useRef(45);
  const audioSinkRef = useRef<HTMLDivElement>(null);
  const inPrayerRoomRef = useRef(inPrayerRoom);
  inPrayerRoomRef.current = inPrayerRoom;

  const patch = useCallback((p: Partial<DmCallState>) => setCall((c) => ({ ...c, ...p })), []);

  const stopTone = () => {
    toneRef.current?.stop();
    toneRef.current = null;
  };
  const clearTimers = () => {
    if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    ringTimerRef.current = null;
    endTimerRef.current = null;
  };

  const leaveRoom = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (audioSinkRef.current) audioSinkRef.current.innerHTML = '';
    if (room) await room.disconnect(true).catch(() => {});
  }, []);

  /** Show "Call ended" briefly, then close the screen. */
  const finish = useCallback(
    (reason: string) => {
      stopTone();
      clearTimers();
      void leaveRoom();
      if (!inPrayerRoomRef.current) setCallActive(false);
      setCall((c) => (c.phase === 'idle' ? c : { ...c, phase: 'ended', endedReason: reason, remoteVideo: null, localVideo: null, minimized: false }));
      endTimerRef.current = window.setTimeout(() => setCall(IDLE), 1800);
    },
    [leaveRoom]
  );

  const connect = useCallback(
    async (pass: DmCallPass, opts: { outgoing: boolean }) => {
      const { Room, RoomEvent, Track: TrackNS } = await import('livekit-client');
      const { connectLiveKitOnce } = await import('../lib/livekitConnect');
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const showRemote = () => {
        if (roomRef.current !== room) return;
        let video: Track | null = null;
        for (const p of room.remoteParticipants.values()) {
          const pub = p.getTrackPublication(TrackNS.Source.Camera);
          if (pub?.track && !pub.isMuted) video = pub.track;
        }
        patch({ remoteVideo: video, remoteCameraOn: Boolean(video) });
      };
      const markConnected = () => {
        if (roomRef.current !== room || room.remoteParticipants.size === 0) return;
        stopTone();
        clearTimers();
        setCall((c) => (c.phase === 'connected' ? c : { ...c, phase: 'connected', connectedAt: c.connectedAt || Date.now() }));
      };

      room
        .on(RoomEvent.ParticipantConnected, markConnected)
        .on(RoomEvent.ParticipantDisconnected, () => {
          if (roomRef.current !== room) return;
          if (room.remoteParticipants.size === 0 && callRef.current.phase !== 'outgoing') {
            void endDmCall(pass.channelId);
            finish('ended');
          }
        })
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === TrackNS.Kind.Audio && audioSinkRef.current) {
            const el = track.attach();
            el.setAttribute('playsinline', 'true');
            audioSinkRef.current.appendChild(el);
          }
          showRemote();
          markConnected();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
          showRemote();
        })
        .on(RoomEvent.TrackMuted, showRemote)
        .on(RoomEvent.TrackUnmuted, showRemote)
        .on(RoomEvent.Reconnecting, () => patch({ phase: 'reconnecting' }))
        .on(RoomEvent.Reconnected, () => patch({ phase: room.remoteParticipants.size ? 'connected' : 'outgoing' }))
        .on(RoomEvent.Disconnected, () => {
          if (roomRef.current !== room) return;
          finish(callRef.current.phase === 'outgoing' ? 'no-answer' : 'ended');
        })
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === TrackNS.Source.Camera) patch({ localVideo: pub.track || null, cameraOn: true });
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub.source === TrackNS.Source.Camera) patch({ localVideo: null, cameraOn: false });
        });

      await connectLiveKitOnce(room, pass.url, pass.token);
      if (roomRef.current !== room) {
        await room.disconnect(true).catch(() => {});
        return;
      }
      setCallActive(true);
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        patch({ micOn: false, notice: 'Allow the microphone to talk.' });
      }
      if (pass.video) {
        try {
          await room.localParticipant.setCameraEnabled(true, { facingMode: 'user' });
        } catch {
          patch({ cameraOn: false, notice: 'Allow the camera to show your video.' });
        }
      }
      showRemote();
      if (room.remoteParticipants.size > 0) markConnected();
      else if (!opts.outgoing) {
        // Caller hung up while we were connecting.
        void endDmCall(pass.channelId);
        finish('ended');
      }
    },
    [finish, patch]
  );

  const startCall = useCallback(
    async (opts: { channelId: string; partnerName: string; video: boolean }) => {
      if (callRef.current.phase !== 'idle' && callRef.current.phase !== 'ended') return;
      if (inPrayerRoomRef.current) {
        setCall({ ...IDLE, phase: 'ended', channelId: opts.channelId, partnerName: opts.partnerName, endedReason: 'failed', notice: 'Leave the prayer room first, then call.' });
        endTimerRef.current = window.setTimeout(() => setCall(IDLE), 3000);
        return;
      }
      clearTimers();
      setCall({ ...IDLE, phase: 'outgoing', outgoing: true, channelId: opts.channelId, partnerName: opts.partnerName, video: opts.video, cameraOn: opts.video });
      toneRef.current = startRingback();
      try {
        const pass = await ringDmCall(opts.channelId, opts.video);
        if (callRef.current.channelId !== opts.channelId || callRef.current.phase === 'ended' || callRef.current.phase === 'idle') {
          void endDmCall(opts.channelId);
          return;
        }
        ringTimerRef.current = window.setTimeout(() => {
          if (callRef.current.phase === 'outgoing') {
            void endDmCall(opts.channelId);
            finish('no-answer');
          }
        }, pass.ringSeconds * 1000);
        await connect(pass, { outgoing: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The call did not go through.';
        reportIssue({ area: 'media', code: 'dm_call_ring_failed', message, channelId: opts.channelId });
        stopTone();
        clearTimers();
        void leaveRoom();
        setCall((c) => ({ ...c, phase: 'ended', endedReason: 'failed', notice: message }));
        endTimerRef.current = window.setTimeout(() => setCall(IDLE), 3500);
      }
    },
    [connect, finish, leaveRoom]
  );

  const answer = useCallback(async () => {
    const c = callRef.current;
    if (c.phase !== 'incoming' || !c.channelId) return;
    if (inPrayerRoomRef.current) {
      patch({ notice: 'Leave the prayer room first, then answer.' });
      return;
    }
    stopTone();
    clearTimers();
    patch({ phase: 'connecting', cameraOn: c.video });
    try {
      const pass = await joinDmCall(c.channelId);
      await connect(pass, { outgoing: false });
    } catch (err) {
      const ended = err instanceof DmCallError && err.code === 'call_ended';
      if (!ended) {
        reportIssue({ area: 'media', code: 'dm_call_answer_failed', message: err instanceof Error ? err.message : String(err), channelId: c.channelId });
      }
      void leaveRoom();
      setCall((s) => ({ ...s, phase: 'ended', endedReason: ended ? 'ended' : 'failed', notice: ended ? null : err instanceof Error ? err.message : null }));
      endTimerRef.current = window.setTimeout(() => setCall(IDLE), 2500);
    }
  }, [connect, leaveRoom, patch]);

  const decline = useCallback(() => {
    const c = callRef.current;
    if (c.channelId) void declineDmCall(c.channelId);
    stopTone();
    clearTimers();
    setCall(IDLE);
  }, []);

  const hangUp = useCallback(() => {
    const c = callRef.current;
    if (c.channelId) void endDmCall(c.channelId);
    finish('ended');
  }, [finish]);

  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    const next = !callRef.current.micOn;
    patch({ micOn: next });
    void room?.localParticipant.setMicrophoneEnabled(next).catch(() => patch({ micOn: !next }));
  }, [patch]);

  const toggleCamera = useCallback(() => {
    const room = roomRef.current;
    const next = !callRef.current.cameraOn;
    patch({ cameraOn: next, video: callRef.current.video || next });
    void room?.localParticipant
      .setCameraEnabled(next, { facingMode: callRef.current.facing })
      .then(() => {
        const pub = room.localParticipant.getTrackPublications().find((p) => p.source === 'camera');
        patch({ localVideo: next ? pub?.track || null : null });
      })
      .catch(() => patch({ cameraOn: !next, notice: 'Allow the camera to show your video.' }));
  }, [patch]);

  const flipCamera = useCallback(() => {
    const room = roomRef.current;
    const next = callRef.current.facing === 'user' ? 'environment' : 'user';
    const pub = room?.localParticipant.getTrackPublications().find((p) => p.source === 'camera');
    const track = pub?.track as LocalVideoTrack | undefined;
    if (!track) return;
    void track
      .restartTrack({ facingMode: next })
      .then(() => patch({ facing: next }))
      .catch(() => patch({ notice: 'This phone has only one camera.' }));
  }, [patch]);

  const setMinimized = useCallback((on: boolean) => patch({ minimized: on }), [patch]);
  const dismiss = useCallback(() => {
    clearTimers();
    setCall(IDLE);
  }, []);

  const showIncoming = useCallback((opts: { channelId: string; partnerName: string; video: boolean }) => {
    const c = callRef.current;
    if (c.phase !== 'idle' && c.phase !== 'ended') {
      if (c.channelId !== opts.channelId) void declineDmCall(opts.channelId); // busy on another call
      return;
    }
    clearTimers();
    setCall({ ...IDLE, phase: 'incoming', channelId: opts.channelId, partnerName: opts.partnerName, video: opts.video, cameraOn: opts.video });
    stopTone();
    toneRef.current = startRingtone();
    ringTimerRef.current = window.setTimeout(() => {
      if (callRef.current.phase === 'incoming' && callRef.current.channelId === opts.channelId) {
        stopTone();
        setCall(IDLE);
      }
    }, (ringSecondsRef.current + 5) * 1000);
  }, []);

  const checkIncoming = useCallback(
    async (channelId: string, partnerName?: string) => {
      const status = await fetchDmCallStatus(channelId);
      if (status?.ringing) showIncoming({ channelId, partnerName: status.callerName || partnerName || 'Someone', video: status.video });
    },
    [showIncoming]
  );

  // Listen for incoming calls on my private call topic. Keeps retrying if the topic can't be
  // fetched or the live connection drops, and also asks "is anyone calling me?" when the app
  // opens or comes back to the front (and every 20s while open), so a missed ping still rings.
  useEffect(() => {
    if (!selfId || memberAccessState !== 'approved_member') return;
    let alive = true;
    let channel: RealtimeChannel | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;

    const checkPending = async () => {
      if (!alive || document.visibilityState !== 'visible') return;
      const c = callRef.current;
      if (c.phase !== 'idle' && c.phase !== 'ended') return;
      const pending = await fetchPendingCall();
      if (alive && pending) showIncoming({ channelId: pending.channelId, partnerName: pending.callerName, video: pending.video });
    };

    const retryLater = () => {
      if (!alive || retryTimer) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void subscribe();
      }, inboxRetryDelayMs(attempt++));
    };

    const subscribe = async () => {
      if (!alive || !isSupabaseConfigured) return;
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
      let topic: string | null = null;
      try {
        const inbox = await fetchCallInbox();
        topic = inbox.topic;
        ringSecondsRef.current = inbox.ringSeconds;
      } catch {
        topic = null;
      }
      if (!alive) return;
      if (!topic) {
        retryLater();
        return;
      }
      channel = supabase
        .channel(topic, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'ring' }, (msg) => {
          const p = (msg.payload || {}) as Record<string, string>;
          if (!p.channelId || p.callerId === selfId) return;
          showIncoming({ channelId: p.channelId, partnerName: p.callerName || 'Someone', video: p.video === '1' });
        })
        .on('broadcast', { event: 'ended' }, (msg) => {
          const p = (msg.payload || {}) as Record<string, string>;
          const c = callRef.current;
          if (!p.channelId || p.channelId !== c.channelId) return;
          if (c.phase === 'incoming') {
            stopTone();
            clearTimers();
            setCall(IDLE); // they gave up, or I declined on another phone
          } else if (c.phase === 'outgoing' && p.by !== selfId) {
            void endDmCall(p.channelId);
            finish(p.reason === 'declined' ? 'declined' : 'ended');
          } else if ((c.phase === 'connected' || c.phase === 'connecting' || c.phase === 'reconnecting') && p.by !== selfId) {
            finish('ended');
          }
        })
        .on('broadcast', { event: 'answered' }, (msg) => {
          const p = (msg.payload || {}) as Record<string, string>;
          const c = callRef.current;
          // Answered on another of my phones: stop ringing here.
          if (c.phase === 'incoming' && p.channelId === c.channelId) {
            stopTone();
            clearTimers();
            setCall(IDLE);
          }
        })
        .subscribe((status) => {
          if (!alive) return;
          if (status === 'SUBSCRIBED') {
            attempt = 0;
            void checkPending();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            retryLater();
          }
        });
    };

    void subscribe();
    void checkPending();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void checkPending();
      if (!channel) void subscribe();
    };
    const onOnline = () => void subscribe();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const poll = window.setInterval(() => void checkPending(), 20_000);
    return () => {
      alive = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [finish, memberAccessState, selfId, showIncoming]);

  // Leaving the page mid-call: tell the other side.
  useEffect(() => {
    const onHide = () => {
      const c = callRef.current;
      if (c.channelId && (c.phase === 'outgoing' || c.phase === 'connected')) void endDmCall(c.channelId);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  useEffect(
    () => () => {
      stopTone();
      clearTimers();
      void leaveRoom();
    },
    [leaveRoom]
  );

  const value: DmCallContextValue = {
    call,
    inPrayerRoom,
    startCall,
    answer,
    decline,
    hangUp,
    toggleMic,
    toggleCamera,
    flipCamera,
    setMinimized,
    dismiss,
    checkIncoming,
    audioSinkRef,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div ref={audioSinkRef} className="hidden" aria-hidden />
      {call.phase !== 'idle' ? (
        <Suspense fallback={null}>
          <DmCallScreen />
        </Suspense>
      ) : null}
      {/* Floating window for using other apps during the call (stays mounted while minimized). */}
      {['outgoing', 'connecting', 'connected', 'reconnecting'].includes(call.phase) ? (
        <Suspense fallback={null}>
          <CallPip />
        </Suspense>
      ) : null}
    </Ctx.Provider>
  );
};
