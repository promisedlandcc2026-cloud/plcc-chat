/**
 * Floating call window (picture-in-picture), like WhatsApp: the call stays on top while you
 * use other apps or browser tabs. Video calls float the other person's video; voice calls
 * float a small card with their name and the call time.
 *
 * Stays mounted for the whole call (even when the in-app screen is minimized), so the
 * floating window never closes by itself. Phones/browsers that support it also float
 * automatically when you leave the app (Chrome's auto picture-in-picture, Safari's
 * autopictureinpicture), and the floating window gets Mute / Camera / Hang up buttons.
 */
import React, { useEffect, useRef } from 'react';
import { useDmCall } from '../../context/DmCallContext';
import { callStatusLine } from '../../lib/dmCall';
import { registerPipVideo } from '../../lib/callPip';

function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '•';
}

export const CallPip: React.FC = () => {
  const ctx = useDmCall();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const call = ctx?.call;
  const remoteVideo = call?.remoteVideo || null;
  const stateRef = useRef(call);
  stateRef.current = call;

  // The voice-call card: drawn on a small canvas, refreshed every second.
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    canvasRef.current = canvas;
    const draw = () => {
      const c = stateRef.current;
      const g = canvas.getContext('2d');
      if (!g || !c) return;
      const grad = g.createLinearGradient(0, 0, 0, 270);
      grad.addColorStop(0, '#1d372c');
      grad.addColorStop(1, '#0b1510');
      g.fillStyle = grad;
      g.fillRect(0, 0, 480, 270);
      g.fillStyle = 'rgba(201,163,90,0.3)';
      g.beginPath();
      g.arc(240, 95, 52, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#E8D8B2';
      g.font = 'bold 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(initials(c.partnerName), 240, 97);
      g.fillStyle = '#ffffff';
      g.font = 'bold 30px system-ui, sans-serif';
      g.fillText(String(c.partnerName || '').slice(0, 26), 240, 186);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.font = '24px system-ui, sans-serif';
      const seconds = c.connectedAt ? (Date.now() - c.connectedAt) / 1000 : 0;
      g.fillText(`${c.micOn ? '' : '🔇 '}${callStatusLine(c.phase, { video: c.video, seconds, endedReason: c.endedReason })}`, 240, 226);
    };
    draw();
    const timer = window.setInterval(draw, 1000);
    const capture = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
    streamRef.current = capture ? capture.call(canvas, 2) : null;
    return () => {
      window.clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Show their video when they have the camera on, otherwise the voice-call card.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (remoteVideo) {
      remoteVideo.attach(el);
      return () => {
        remoteVideo.detach(el);
      };
    }
    if (streamRef.current) el.srcObject = streamRef.current;
    void el.play().catch(() => {});
    return undefined;
  }, [remoteVideo]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.setAttribute('autopictureinpicture', '');
    (el as HTMLVideoElement & { autoPictureInPicture?: boolean }).autoPictureInPicture = true;
    const onEnter = () => ctx?.setMinimized(true);
    el.addEventListener('enterpictureinpicture', onEnter);
    el.addEventListener('webkitpresentationmodechanged', onEnter);
    const unregister = registerPipVideo(el);
    return () => {
      el.removeEventListener('enterpictureinpicture', onEnter);
      el.removeEventListener('webkitpresentationmodechanged', onEnter);
      unregister();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Buttons on the floating window / lock screen (where the browser supports them).
  useEffect(() => {
    if (!ctx || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession as MediaSession & {
      setMicrophoneActive?: (on: boolean) => void;
      setCameraActive?: (on: boolean) => void;
    };
    const set = (action: string, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action as MediaSessionAction, fn);
      } catch {
        /* not supported here */
      }
    };
    set('hangup', ctx.hangUp);
    set('togglemicrophone', ctx.toggleMic);
    set('togglecamera', ctx.toggleCamera);
    set('enterpictureinpicture', () => {
      const el = videoRef.current;
      if (el && document.pictureInPictureElement !== el) void el.requestPictureInPicture?.().catch(() => {});
    });
    return () => {
      for (const a of ['hangup', 'togglemicrophone', 'togglecamera', 'enterpictureinpicture']) set(a, null);
    };
  }, [ctx]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !call) return;
    const ms = navigator.mediaSession as MediaSession & {
      setMicrophoneActive?: (on: boolean) => void;
      setCameraActive?: (on: boolean) => void;
    };
    try {
      ms.setMicrophoneActive?.(call.micOn);
      ms.setCameraActive?.(call.cameraOn);
      ms.metadata = new MediaMetadata({ title: call.partnerName, artist: call.video ? 'PLCC video call' : 'PLCC voice call' });
    } catch {
      /* not supported here */
    }
  }, [call?.micOn, call?.cameraOn, call?.partnerName, call?.video]);

  // Close the floating window when the call ends.
  useEffect(
    () => () => {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    },
    []
  );

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      aria-hidden
      // Kept on the page (not display:none) so the browser lets it float.
      className="fixed bottom-0 right-0 w-px h-px opacity-0 pointer-events-none"
    />
  );
};
