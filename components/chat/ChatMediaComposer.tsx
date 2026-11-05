import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Camera, HeartHandshake, FileText, Image as ImageIcon, Loader2, Mic, Paperclip, Send, Trash2, X } from 'lucide-react';
import type { CommunityChatMessage } from '../../lib/communityChatTypes';
import { Portal } from './Portal';
import { CommunityChatError } from '../../lib/communityChatTypes';
import {
  CHAT_MEDIA_MAX_BYTES,
  baseMime,
  formatFileSize,
  mediaKindForMime,
  pickRecorderMime,
  preparePhoto,
  sendChatMedia,
  voiceNoteFilename,
} from '../../lib/chatMedia';

const DOC_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain';

/** Some phones leave file.type empty for documents — guess from the name. */
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};
function mimeFor(file: File): string {
  const t = baseMime(file.type);
  if (t) return t;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function errorText(err: unknown): string {
  if (err instanceof CommunityChatError) return err.message;
  return 'Could not send that. Please try again.';
}

type Pending = { file: File; mime: string; previewUrl: string | null };

/** Paperclip → Photo / Camera / Document, then a preview with an optional caption. */
export const ChatAttachButton: React.FC<{
  channelId: string;
  disabled?: boolean;
  onSent: (message: CommunityChatMessage) => void;
  onError: (message: string | null) => void;
  /** Shows a "Poll" choice in the menu. */
  onPoll?: () => void;
  /** Shows an "Event / Serve" choice in the menu. */
  onShareCard?: () => void;
  /** Shows an "Ask for help" choice in the menu. */
  onRequest?: () => void;
}> = ({ channelId, disabled, onSent, onError, onPoll, onShareCard, onRequest }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [caption, setCaption] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  /** Phones and tablets open the camera; computers would just show the file picker again. */
  const hasCamera =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

  useEffect(() => () => {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setMenuOpen(false);
    if (!file) return;
    if (file.size > CHAT_MEDIA_MAX_BYTES && !file.type.startsWith('image/')) {
      onError(`That file is ${formatFileSize(file.size)}. The limit is 25 MB.`);
      return;
    }
    const mime = mimeFor(file);
    const kind = mediaKindForMime(mime);
    onError(null);
    setCaption('');
    setPending({
      file,
      mime,
      previewUrl: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : null,
    });
  };

  const send = async () => {
    if (!pending) return;
    try {
      let blob: Blob = pending.file;
      let mime = pending.mime;
      let name = pending.file.name || 'file';
      if (mediaKindForMime(mime) === 'image') {
        setStage('Preparing photo…');
        const photo = await preparePhoto(pending.file);
        blob = photo.blob;
        mime = photo.mime;
        name = photo.name;
      }
      const { message } = await sendChatMedia({
        channelId,
        blob,
        filename: name,
        mime,
        caption,
        onStage: (s) =>
          setStage(s === 'uploading' ? 'Uploading…' : s === 'finishing' ? 'Almost done…' : 'Sending…'),
      });
      onSent(message);
      setPending(null);
      setCaption('');
    } catch (err) {
      onError(errorText(err));
    } finally {
      setStage(null);
    }
  };

  const kind = pending ? mediaKindForMime(pending.mime) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={disabled}
        className="min-h-[48px] min-w-[48px] rounded-2xl bg-white border border-gray-200 text-burgundy flex items-center justify-center disabled:opacity-40"
        aria-label="Send a photo, video, document or poll"
        aria-expanded={menuOpen}
      >
        <Paperclip size={20} aria-hidden />
      </button>

      <input ref={galleryRef} type="file" accept="image/*,video/*" className="hidden" onChange={pick} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={docRef} type="file" accept={DOC_ACCEPT} className="hidden" onChange={pick} />

      {menuOpen ? (
        <Portal>
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center" onClick={() => setMenuOpen(false)}>
          <div
            className={`w-full max-w-[500px] lg:max-w-[460px] rounded-t-3xl lg:rounded-3xl bg-white shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] grid gap-3 ${
              [3, 5, 6].includes((hasCamera ? 3 : 2) + (onPoll ? 1 : 0) + (onShareCard ? 1 : 0) + (onRequest ? 1 : 0)) ? 'grid-cols-3' : 'grid-cols-2'
            }`}
            onClick={(e) => e.stopPropagation()}
            role="menu"
            aria-label="Send a file"
          >
            {[
              { label: 'Photo or video', hint: 'From your photos', icon: ImageIcon, ref: galleryRef, show: true },
              { label: 'Camera', hint: 'Take a photo now', icon: Camera, ref: cameraRef, show: hasCamera },
              { label: 'Document', hint: 'PDF, Word, Excel…', icon: FileText, ref: docRef, show: true },
              { label: 'Poll', hint: 'Ask the group', icon: BarChart3, ref: null, show: Boolean(onPoll) },
              { label: 'Event / Serve', hint: 'Share from the calendar', icon: CalendarDays, ref: null, show: Boolean(onShareCard) },
              { label: 'Ask for help', hint: 'Ride, visit, meal…', icon: HeartHandshake, ref: null, show: Boolean(onRequest) },
            ]
              .filter((o) => o.show)
              .map(({ label, hint, icon: Icon, ref }) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (ref) ref.current?.click();
                    else {
                      setMenuOpen(false);
                      if (label === 'Poll') onPoll?.();
                      else if (label === 'Ask for help') onRequest?.();
                      else onShareCard?.();
                    }
                  }}
                  className="min-h-[104px] rounded-2xl bg-eggshell flex flex-col items-center justify-center gap-1.5 px-2 text-center active:bg-gold/20 hover:bg-gold/10"
                >
                  <Icon size={28} className="text-burgundy" aria-hidden />
                  <span className="text-sm font-bold text-[#1A1A1A]">{label}</span>
                  <span className="text-xs text-gray-500">{hint}</span>
                </button>
              ))}
          </div>
        </div>
        </Portal>
      ) : null}

      {pending ? (
        <Portal>
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col" role="dialog" aria-modal="true" aria-label="Send file">
          <div className="flex justify-end p-3">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={Boolean(stage)}
              className="min-h-[48px] min-w-[48px] rounded-full bg-white/15 text-white flex items-center justify-center"
              aria-label="Cancel"
            >
              <X size={24} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
            {kind === 'image' && pending.previewUrl ? (
              <img src={pending.previewUrl} alt="" className="max-h-full max-w-full object-contain rounded-xl" />
            ) : kind === 'video' && pending.previewUrl ? (
              <video src={pending.previewUrl} controls playsInline className="max-h-full max-w-full rounded-xl" />
            ) : (
              <div className="rounded-3xl bg-white p-6 flex items-center gap-4 max-w-sm w-full">
                <FileText size={36} className="text-burgundy shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="font-bold text-[#1A1A1A] truncate">{pending.file.name}</p>
                  <p className="text-sm text-gray-500">{formatFileSize(pending.file.size)}</p>
                </div>
              </div>
            )}
          </div>
          <div className="p-3 flex gap-2 items-end max-w-[500px] w-full mx-auto">
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption…"
              maxLength={1000}
              className="flex-1 min-h-[52px] rounded-2xl bg-white px-4 text-base text-[#1A1A1A] focus:outline-none"
              disabled={Boolean(stage)}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={Boolean(stage)}
              className="min-h-[52px] px-5 rounded-2xl bg-burgundy text-white font-bold flex items-center gap-2 disabled:opacity-70"
            >
              {stage ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
              {stage || 'Send'}
            </button>
          </div>
        </div>
        </Portal>
      ) : null}
    </>
  );
};

/** Tap to record, tap Send (no press-and-hold — easier for everyone). */
export function useVoiceRecorder(opts: {
  channelId: string;
  onSent: (message: CommunityChatMessage) => void;
  onError: (message: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const sendOnStopRef = useRef(false);
  const MAX_SECONDS = 10 * 60;

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setSeconds(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const supported =
    typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const start = useCallback(async () => {
    opts.onError(null);
    if (!supported) {
      opts.onError('Voice messages aren’t supported in this browser. Try updating your phone.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const type = baseMime(rec.mimeType || mime || 'audio/webm');
        const blob = new Blob(chunksRef.current, { type });
        const shouldSend = sendOnStopRef.current;
        sendOnStopRef.current = false;
        cleanup();
        if (!shouldSend || blob.size < 1000) return;
        setSending(true);
        try {
          const { message } = await sendChatMedia({
            channelId: opts.channelId,
            blob,
            filename: voiceNoteFilename(type),
            mime: type,
          });
          opts.onSent(message);
        } catch (err) {
          opts.onError(errorText(err));
        } finally {
          setSending(false);
        }
      };
      recorderRef.current = rec;
      rec.start(1000);
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            sendOnStopRef.current = true;
            recorderRef.current?.stop();
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      cleanup();
      opts.onError('Allow the microphone for PLCC Chat to send voice messages.');
    }
  }, [cleanup, opts, supported]);

  const stop = useCallback((send: boolean) => {
    sendOnStopRef.current = send;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    else cleanup();
  }, [cleanup]);

  return { supported, recording, seconds, sending, start, send: () => stop(true), cancel: () => stop(false) };
}

export const VoiceRecordingBar: React.FC<{ seconds: number; onCancel: () => void; onSend: () => void }> = ({
  seconds,
  onCancel,
  onSend,
}) => {
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="flex-1 flex items-center gap-2" role="status" aria-live="polite">
      <button
        type="button"
        onClick={onCancel}
        className="min-h-[48px] min-w-[48px] rounded-2xl bg-white border border-gray-200 text-burgundy flex items-center justify-center"
        aria-label="Cancel voice message"
      >
        <Trash2 size={20} />
      </button>
      <div className="flex-1 min-h-[48px] rounded-2xl bg-white border border-burgundy/30 px-4 flex items-center gap-3">
        <span className="w-3 h-3 rounded-full bg-red-600 animate-pulse" aria-hidden />
        <span className="text-sm font-bold text-[#1A1A1A] tabular-nums">
          Recording {mm}:{ss}
        </span>
      </div>
      <button
        type="button"
        onClick={onSend}
        className="min-h-[48px] min-w-[48px] rounded-2xl bg-burgundy text-white flex items-center justify-center"
        aria-label="Send voice message"
      >
        <Send size={18} />
      </button>
    </div>
  );
};

export const MicButton: React.FC<{ onClick: () => void; busy?: boolean; disabled?: boolean }> = ({
  onClick,
  busy,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    className="min-h-[48px] min-w-[48px] rounded-2xl bg-burgundy text-white flex items-center justify-center disabled:opacity-60"
    aria-label={busy ? 'Sending voice message' : 'Record a voice message'}
  >
    {busy ? <Loader2 className="animate-spin" size={18} /> : <Mic size={20} />}
  </button>
);
