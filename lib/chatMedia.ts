/**
 * Chat media: photos, voice notes, videos and documents.
 *
 * Flow (files never pass through our servers — they go straight to the church's
 * private storage with a one-time link the Vault hands out):
 *   1. send the message (caption, or "📷 Photo" / "🎤 Voice message" / …)
 *   2. ask the Vault for an upload link for that message
 *   3. upload the file to Supabase Storage with that link
 *   4. tell the Vault it's there (Vault checks real type + size, then records it)
 * If any step after 1 fails, the empty message is removed so nobody sees a broken post.
 */
import { supabase } from './supabase';
import { getValidAccessToken } from './authAccessToken';
import { sendChatMessage } from './communityChatClient';
import { CommunityChatError, type CommunityChatAttachment, type CommunityChatMessage } from './communityChatTypes';

export const CHAT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1600;
const PHOTO_QUALITY = 0.82;

export type ChatMediaKind = 'image' | 'audio' | 'video' | 'file';

/** Text used as the message when there's no caption (also what chat previews/alerts show). */
export const AUTO_CAPTION: Record<ChatMediaKind, string> = {
  image: '📷 Photo',
  audio: '🎤 Voice message',
  video: '🎬 Video',
  file: '📎 Document',
};
const AUTO_CAPTIONS = new Set(Object.values(AUTO_CAPTION));

/** Hide the auto caption under media — the media speaks for itself. */
export function visibleCaption(content: string, attachments: CommunityChatAttachment[] | undefined): string {
  if (attachments && attachments.length > 0 && AUTO_CAPTIONS.has(content.trim())) return '';
  return content;
}

export function mediaKindForMime(mime: string): ChatMediaKind {
  const m = baseMime(mime);
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'file';
}

export function baseMime(mime: string): string {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shrink a phone photo (often 4–8 MB) to a sharp ~200–500 KB JPEG.
 * GIFs and anything the browser can't decode are sent as-is.
 */
export async function preparePhoto(file: File): Promise<{ blob: Blob; mime: string; name: string }> {
  const mime = baseMime(file.type);
  if (mime === 'image/gif' || typeof document === 'undefined') {
    return { blob: file, mime: mime || 'image/jpeg', name: file.name };
  }
  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob || (blob.size >= file.size && ['image/jpeg', 'image/png', 'image/webp'].includes(mime))) {
      return { blob: file, mime: mime || 'image/jpeg', name: file.name };
    }
    const name = (file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
    return { blob, mime: 'image/jpeg', name };
  } catch {
    return { blob: file, mime: mime || 'image/jpeg', name: file.name };
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** Best voice-note format this phone can record (iPhone: mp4/aac; Android/Chrome: webm/opus). */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const options = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac'];
  for (const m of options) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function voiceNoteFilename(mime: string, now = new Date()): string {
  const ext = baseMime(mime) === 'audio/mp4' ? 'm4a' : baseMime(mime).split('/')[1] || 'webm';
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `voice-${stamp}.${ext}`;
}

async function postBridge<T>(resource: string, body: unknown): Promise<T> {
  const token = await getValidAccessToken();
  if (!token) throw new CommunityChatError('session_missing', 'Please sign in again to continue.', 401, true);
  let res: Response;
  try {
    res = await fetch(`/api/community-chat?resource=${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CommunityChatError('network', 'No connection. Check your internet and try again.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data?.ok !== true) {
    throw new CommunityChatError(
      (data?.code as any) || 'upload_failed',
      typeof data?.message === 'string' ? data.message : 'Could not send that file. Please try again.',
      res.status
    );
  }
  return data as T;
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  await postBridge('message-delete', { messageId });
}

/** Send one photo / voice note / video / document, with an optional caption. */
export async function sendChatMedia(opts: {
  channelId: string;
  blob: Blob;
  filename: string;
  mime: string;
  caption?: string;
  onStage?: (stage: 'sending' | 'uploading' | 'finishing') => void;
}): Promise<{ message: CommunityChatMessage; attachment: CommunityChatAttachment }> {
  const mime = baseMime(opts.mime);
  const kind = mediaKindForMime(mime);
  if (opts.blob.size <= 0) throw new CommunityChatError('upload_failed', 'That file is empty.', 400);
  if (opts.blob.size > CHAT_MEDIA_MAX_BYTES) {
    throw new CommunityChatError('too_large', 'That file is too big (25 MB max).', 413);
  }
  opts.onStage?.('sending');
  const caption = (opts.caption || '').trim();
  const message = await sendChatMessage(opts.channelId, caption || AUTO_CAPTION[kind]);
  try {
    const up = await postBridge<{ bucket: string; storagePath: string; uploadToken: string }>('attachment-upload-url', {
      messageId: message.id,
      filename: opts.filename,
      mimeType: mime,
      sizeBytes: opts.blob.size,
    });
    opts.onStage?.('uploading');
    const { error } = await supabase.storage
      .from(up.bucket)
      .uploadToSignedUrl(up.storagePath, up.uploadToken, opts.blob, { contentType: mime, upsert: false });
    if (error) throw new CommunityChatError('upload_failed', 'The upload didn’t finish. Please try again.', 502);
    opts.onStage?.('finishing');
    const done = await postBridge<{ attachment: CommunityChatAttachment }>('attachment-confirm', {
      messageId: message.id,
      storagePath: up.storagePath,
      filename: opts.filename,
      mimeType: mime,
    });
    return { message: { ...message, attachments: [done.attachment] }, attachment: done.attachment };
  } catch (err) {
    await deleteChatMessage(message.id).catch(() => undefined);
    throw err;
  }
}

/**
 * Signed links change on every refresh (5 s polling) — keep the first one for
 * 50 minutes so photos and audio don't reload or stop mid-play.
 */
const urlCache = new Map<string, { url: string; at: number }>();
const URL_TTL_MS = 50 * 60 * 1000;
export function stableMediaUrl(att: CommunityChatAttachment, now = Date.now()): string | null {
  const hit = urlCache.get(att.id);
  if (hit && now - hit.at < URL_TTL_MS) return hit.url;
  if (!att.url) return hit?.url ?? null;
  urlCache.set(att.id, { url: att.url, at: now });
  return att.url;
}
