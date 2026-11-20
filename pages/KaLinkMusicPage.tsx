import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Music, Pause, Play, Trash2, Upload, X } from 'lucide-react';
import { MAX_SONG_MB, SONG_ACCEPT, deleteSong, fetchMusicLibrary, uploadSong, type MusicSong } from '../lib/kaLinkMusic';

/**
 * Ka Link Music (Nov 19 2026) — for the music team leaders pick in Canaan, plus the
 * Pastor / Admins / Ka Link team Admins. Upload songs you or the church bought;
 * moderators play them in Ka Link. You can delete your own uploads.
 * Same page in Ka Link and PLCC Tribes.
 */
function mins(sec: number | null): string {
  if (!sec) return '';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export const KaLinkMusicPage: React.FC = () => {
  const [songs, setSongs] = useState<MusicSong[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchased, setPurchased] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; state: 'uploading' | 'done' | 'failed'; message?: string }>>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const lib = await fetchMusicLibrary();
      setSongs(lib.songs);
      setCanManage(lib.canManage);
      setCanManageTeam(lib.canManageTeam);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the songs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => audioRef.current?.pause();
  }, [load]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10);
    setUploads(list.map((f) => ({ name: f.name, state: 'uploading' })));
    for (let i = 0; i < list.length; i += 1) {
      const mark = (state: 'done' | 'failed', message?: string) =>
        setUploads((prev) => prev.map((u, j) => (j === i ? { ...u, state, message } : u)));
      try {
        await uploadSong(list[i], purchased);
        mark('done');
      } catch (e) {
        mark('failed', e instanceof Error ? e.message : 'Upload failed');
      }
    }
    if (fileRef.current) fileRef.current.value = '';
    await load();
  };

  const toggle = (song: MusicSong) => {
    if (!song.url) return;
    audioRef.current?.pause();
    if (playing === song.id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(song.url);
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    audioRef.current = a;
    setPlaying(song.id);
  };

  const remove = async (song: MusicSong) => {
    if (!window.confirm(`Delete “${song.title}”?`)) return;
    try {
      await deleteSong(song.id);
      if (playing === song.id) audioRef.current?.pause();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
  };

  const busy = uploads.some((u) => u.state === 'uploading');

  return (
    <div className="min-h-screen bg-eggshell px-4 pb-24 pt-4 max-w-2xl mx-auto w-full">
      <Link to="/" className="inline-flex items-center gap-2 min-h-[44px] text-sm font-bold text-gray-600">
        <ArrowLeft size={18} aria-hidden /> Back
      </Link>
      <h1 className="mt-2 flex items-center gap-2 text-2xl font-extrabold text-[#1A1A1A]">
        <Music className="text-burgundy" aria-hidden /> Ka Link Music
      </h1>
      <p className="mt-1 text-sm text-gray-600">Songs moderators can play in Ka Link before prayer starts or during an interlude.</p>

      {error ? (
        <p className="mt-4 rounded-2xl bg-red-50 text-red-700 px-4 py-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-gray-600">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </p>
      ) : !canManage ? (
        <p className="mt-6 rounded-2xl bg-white border border-black/5 px-4 py-4 text-sm text-gray-700">
          Only the music team can add songs. Ask the Pastor or an admin to add you in Canaan → Ka Link Music.
        </p>
      ) : (
        <section className="mt-5 rounded-3xl bg-white border border-black/5 p-5 space-y-3" data-testid="music-upload">
          <label className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={purchased} onChange={(e) => setPurchased(e.target.checked)} />
            <span>I bought these songs (or the church is licensed to play them). I won’t upload music I haven’t paid for.</span>
          </label>
          <input ref={fileRef} type="file" accept={SONG_ACCEPT} multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!purchased || busy}
            className="w-full min-h-[56px] rounded-2xl bg-burgundy text-white text-base font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} aria-hidden />} Upload songs
          </button>
          <p className="text-xs text-gray-500 text-center">MP3, M4A, AAC, WAV or OGG · up to {MAX_SONG_MB} MB each</p>
          {uploads.length ? (
            <ul className="space-y-1">
              {uploads.map((u, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  {u.state === 'uploading' ? (
                    <Loader2 size={16} className="animate-spin text-gray-500" />
                  ) : u.state === 'done' ? (
                    <Check size={16} className="text-emerald-600" />
                  ) : (
                    <X size={16} className="text-red-600" />
                  )}
                  <span className="truncate flex-1">{u.name}</span>
                  {u.message ? <span className="text-xs text-red-600">{u.message}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      {!loading ? (
        <section className="mt-5">
          <h2 className="text-lg font-extrabold text-[#1A1A1A]">Library ({songs.length})</h2>
          {songs.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">No songs yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {songs.map((song) => (
                <li key={song.id} className="flex items-center gap-3 rounded-2xl bg-white border border-black/5 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggle(song)}
                    disabled={!song.url}
                    className="min-h-[44px] min-w-[44px] rounded-full bg-burgundy/10 text-burgundy flex items-center justify-center disabled:opacity-40"
                    aria-label={playing === song.id ? `Pause ${song.title}` : `Play ${song.title}`}
                  >
                    {playing === song.id ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm text-[#1A1A1A] truncate">{song.title}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[song.artist, mins(song.durationSeconds), song.mine ? 'Added by you' : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {canManage && (canManageTeam || song.mine) ? (
                    <button
                      type="button"
                      onClick={() => void remove(song)}
                      className="min-h-[44px] min-w-[44px] rounded-xl bg-red-50 text-red-600 flex items-center justify-center"
                      aria-label={`Delete ${song.title}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
};
