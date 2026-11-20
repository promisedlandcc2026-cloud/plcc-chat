/**
 * Ka Link Music from the phone (Nov 19 2026): the music team (people leaders pick in
 * Canaan → Ka Link Music) upload songs they or the church bought; moderators play them
 * in Ka Link. Same file in Ka Link and PLCC Tribes.
 */
import { supabase } from './supabase';

export type MusicSong = {
  id: string;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  url: string | null;
  mine: boolean;
};

export type MusicLibrary = { songs: MusicSong[]; canManage: boolean; canManageTeam: boolean };

export const SONG_ACCEPT = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/ogg,.mp3,.m4a,.aac,.wav,.ogg';
export const MAX_SONG_MB = 25;

async function call(body: Record<string, unknown>): Promise<any> {
  let token: string | null = null;
  try {
    token = (await supabase.auth.getSession()).data.session?.access_token || null;
  } catch {
    token = null;
  }
  if (!token) throw new Error('Please sign in again.');
  const res = await fetch('/api/community-chat?resource=huddle-songs', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok !== true) throw new Error(String(data?.message || 'That did not work. Please try again.'));
  return data;
}

export async function fetchMusicLibrary(): Promise<MusicLibrary> {
  const d = await call({ action: 'list' });
  return { songs: Array.isArray(d.songs) ? d.songs : [], canManage: d.canManage === true, canManageTeam: d.canManageTeam === true };
}

let mayUpload: Promise<boolean> | null = null;
/** Show the "Ka Link Music" link? (music team or managers) Asked once per visit. */
export function canUploadMusicCached(): Promise<boolean> {
  if (!mayUpload) mayUpload = fetchMusicLibrary().then((l) => l.canManage).catch(() => false);
  return mayUpload;
}

function mimeFor(file: File): string {
  const t = (file.type || '').toLowerCase();
  if (t) return t === 'audio/mp3' ? 'audio/mpeg' : t;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext === 'm4a' ? 'audio/x-m4a' : ext === 'aac' ? 'audio/aac' : ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
}

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration) : null);
    a.onerror = () => done(null);
    window.setTimeout(() => done(null), 8000);
    a.src = url;
  });
}

/** Upload one song the uploader confirmed was bought. */
export async function uploadSong(file: File, purchased: boolean): Promise<void> {
  if (!purchased) throw new Error('Please confirm the song was bought first.');
  if (file.size > MAX_SONG_MB * 1024 * 1024) throw new Error(`Songs must be ${MAX_SONG_MB} MB or smaller.`);
  const mime = mimeFor(file);
  const durationSeconds = await readDuration(file);
  const start = await call({ action: 'upload-url', purchased: true, filename: file.name, mime, size: file.size });
  const put = await fetch(String(start.signedUrl), { method: 'PUT', headers: { 'Content-Type': mime }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status}). Please try again.`);
  await call({ action: 'confirm', songId: start.songId, durationSeconds });
}

export async function deleteSong(songId: string): Promise<void> {
  await call({ action: 'delete', songId });
}
