/**
 * The private-call screen: ringing (in / out), the call itself (voice or video),
 * and a small green bar when minimized so people can keep chatting during a call.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, PictureInPicture2, RefreshCw, Video, VideoOff } from 'lucide-react';
import type { Track } from 'livekit-client';
import { useDmCall } from '../../context/DmCallContext';
import { callStatusLine } from '../../lib/dmCall';
import { useScreenWakeLock } from '../../lib/useScreenWakeLock';
import { enterCallPip, pipSupported } from '../../lib/callPip';

function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '•';
}

const VideoView: React.FC<{ track: Track; mirror?: boolean; className?: string }> = ({ track, mirror, className }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={`${className || ''} object-cover ${mirror ? '-scale-x-100' : ''}`} />;
};

const RoundButton: React.FC<{
  label: string;
  onClick: () => void;
  tone?: 'red' | 'green' | 'glass' | 'off';
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ label, onClick, tone = 'glass', children, disabled }) => {
  const tones = {
    red: 'bg-red-600 text-white active:bg-red-700',
    green: 'bg-emerald-500 text-white active:bg-emerald-600',
    glass: 'bg-white/15 text-white active:bg-white/25',
    off: 'bg-white text-[#12231c] active:bg-white/80',
  } as const;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg disabled:opacity-40 ${tones[tone]}`}
      >
        {children}
      </button>
      <span className="text-[12px] text-white/80 font-semibold">{label}</span>
    </div>
  );
};

export const DmCallScreen: React.FC = () => {
  const ctx = useDmCall();
  const [now, setNow] = useState(Date.now());
  const call = ctx?.call;
  const live = call ? call.phase === 'connected' || call.phase === 'reconnecting' : false;
  useScreenWakeLock(Boolean(call && call.phase !== 'idle' && call.phase !== 'ended' && call.video));

  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);

  if (!ctx || !call || call.phase === 'idle') return null;
  const seconds = call.connectedAt ? (now - call.connectedAt) / 1000 : 0;
  const status = callStatusLine(call.phase, { video: call.video, seconds, endedReason: call.endedReason });

  if (call.minimized && call.phase !== 'incoming') {
    return (
      <button
        type="button"
        onClick={() => ctx.setMinimized(false)}
        className="fixed top-[max(env(safe-area-inset-top),0.5rem)] left-1/2 -translate-x-1/2 z-[480] flex items-center gap-2 rounded-full bg-emerald-600 text-white pl-3 pr-4 py-2 shadow-xl text-sm font-bold"
        aria-label={`Back to your call with ${call.partnerName}`}
      >
        <span className="w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden />
        {call.partnerName} · {status}
        <Maximize2 size={14} aria-hidden />
      </button>
    );
  }

  const showVideo = call.video && (call.remoteVideo || call.localVideo);

  return (
    <div
      className="fixed inset-0 z-[480] flex flex-col bg-gradient-to-b from-[#1d372c] via-[#12231c] to-[#0b1510] text-white"
      role="dialog"
      aria-modal="true"
      aria-label={call.video ? `Video call with ${call.partnerName}` : `Voice call with ${call.partnerName}`}
    >
      {/* Remote video fills the screen */}
      {call.remoteVideo ? (
        <VideoView track={call.remoteVideo} className="absolute inset-0 w-full h-full" />
      ) : null}
      {/* My video: full screen while ringing, small corner preview once connected */}
      {call.localVideo && call.cameraOn ? (
        <VideoView
          track={call.localVideo}
          mirror={call.facing === 'user'}
          className={
            call.remoteVideo
              ? 'absolute right-3 top-[calc(env(safe-area-inset-top)+4.5rem)] w-28 h-40 rounded-2xl border-2 border-white/70 shadow-xl z-10'
              : 'absolute inset-0 w-full h-full opacity-60'
          }
        />
      ) : null}

      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <span className="text-[12px] tracking-[0.18em] font-bold text-gold-light/90">
          {call.video ? 'PLCC VIDEO CALL' : 'PLCC VOICE CALL'}
        </span>
        {call.phase !== 'incoming' && call.phase !== 'ended' ? (
          <div className="flex items-center gap-1">
            {pipSupported() ? (
              <button
                type="button"
                onClick={() => {
                  void enterCallPip().then((ok) => {
                    if (ok) ctx.setMinimized(true);
                  });
                }}
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 text-sm font-bold active:bg-white/25"
                aria-label="Float the call so you can use other apps"
                data-testid="call-float"
              >
                <PictureInPicture2 size={18} aria-hidden />
                Float
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => ctx.setMinimized(true)}
              className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 text-sm font-bold active:bg-white/25"
              aria-label="Minimize the call (keep using Ka Link)"
              data-testid="call-minimize"
            >
              <Minimize2 size={18} aria-hidden />
              Minimize
            </button>
          </div>
        ) : (
          <span className="min-h-[44px]" />
        )}
      </div>

      <div className={`relative z-10 flex flex-col items-center text-center px-6 ${showVideo && call.remoteVideo ? 'mt-2' : 'mt-[12vh]'}`}>
        {!call.remoteVideo ? (
          <div
            className={`w-28 h-28 rounded-full bg-gold/25 border-2 border-gold/70 flex items-center justify-center text-4xl font-black text-gold-light mb-5 ${
              call.phase === 'incoming' || call.phase === 'outgoing' ? 'animate-pulse' : ''
            }`}
            aria-hidden
          >
            {initials(call.partnerName)}
          </div>
        ) : null}
        <h2 className="text-2xl font-bold drop-shadow">{call.partnerName}</h2>
        <p className="mt-1 text-base text-white/80 drop-shadow" role="status" aria-live="polite">
          {status}
        </p>
        {call.phase === 'connected' && call.video && !call.remoteCameraOn && call.remoteVideo === null ? (
          <p className="mt-2 text-sm text-white/60">Their camera is off</p>
        ) : null}
        {call.notice ? <p className="mt-3 text-sm bg-black/40 rounded-xl px-3 py-2">{call.notice}</p> : null}
        {call.phase === 'incoming' && ctx.inPrayerRoom ? (
          <p className="mt-3 text-sm bg-black/40 rounded-xl px-3 py-2">You’re in a prayer room. Leave it to answer.</p>
        ) : null}
      </div>

      <div className="relative z-10 mt-auto pb-[max(env(safe-area-inset-bottom),1.5rem)] px-6">
        {call.phase === 'incoming' ? (
          <div className="flex items-center justify-around">
            <RoundButton label="Decline" tone="red" onClick={ctx.decline}>
              <PhoneOff size={28} />
            </RoundButton>
            <RoundButton label="Answer" tone="green" onClick={() => void ctx.answer()} disabled={ctx.inPrayerRoom}>
              {call.video ? <Video size={28} /> : <Phone size={28} />}
            </RoundButton>
          </div>
        ) : call.phase === 'ended' ? (
          <div className="flex justify-center">
            <button type="button" onClick={ctx.dismiss} className="min-h-[48px] px-6 rounded-full bg-white/15 font-bold">
              Close
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-around">
            <RoundButton label={call.micOn ? 'Mute' : 'Unmute'} tone={call.micOn ? 'glass' : 'off'} onClick={ctx.toggleMic}>
              {call.micOn ? <Mic size={26} /> : <MicOff size={26} />}
            </RoundButton>
            <RoundButton label={call.cameraOn ? 'Camera off' : 'Camera'} tone={call.cameraOn ? 'glass' : 'off'} onClick={ctx.toggleCamera}>
              {call.cameraOn ? <Video size={26} /> : <VideoOff size={26} />}
            </RoundButton>
            {call.cameraOn ? (
              <RoundButton label="Flip" onClick={ctx.flipCamera}>
                <RefreshCw size={24} />
              </RoundButton>
            ) : null}
            <RoundButton label="End" tone="red" onClick={ctx.hangUp}>
              <PhoneOff size={28} />
            </RoundButton>
          </div>
        )}
      </div>
    </div>
  );
};
