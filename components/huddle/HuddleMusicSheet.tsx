import React from 'react';
import { ListMusic, Loader2, Music, Play, SkipForward, Square, X } from 'lucide-react';
import type { KaLinkSong } from '../../lib/communityChatClient';
import { HUDDLE_MUSIC_MAX_VOLUME, HUDDLE_MUSIC_MIN_VOLUME } from '../../lib/huddleMusic';

/**
 * #12: moderators choose what plays during waiting times and interludes.
 * The church's library is managed in PLCC Canaan → More → Ka Link Music.
 */

export const DEFAULT_SONG_ID = 'default';

function mins(sec: number | null): string {
  if (!sec) return '';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function HuddleMusicSheet({
  songs,
  loading,
  error,
  playing,
  busy,
  nowPlayingId,
  nowPlayingTitle,
  queueLength,
  volume,
  onPlay,
  onPlayAll,
  onNext,
  onStop,
  onVolume,
  onClose,
}: {
  songs: KaLinkSong[] | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  busy: boolean;
  nowPlayingId: string | null;
  nowPlayingTitle: string | null;
  queueLength: number;
  volume: number;
  onPlay: (songId: string) => void;
  onPlayAll: () => void;
  onNext: () => void;
  onStop: () => void;
  onVolume: (v: number) => void;
  onClose: () => void;
}) {
  const playable = (songs || []).filter((s) => s.url);
  return (
    <div className="pr-sheet-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Music" className="pr-sheet" onClick={(e) => e.stopPropagation()} data-testid="huddle-music-sheet">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-lg font-extrabold">
            <span className="pr-info-icon"><Music size={16} aria-hidden /></span>
            Music
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-black/5 flex items-center justify-center">
            <X size={18} aria-hidden />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Everyone in the room hears it, softly under the voices.</p>

        {playing ? (
          <div className="mt-4 rounded-2xl bg-burgundy/5 border border-burgundy/15 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Now playing</p>
                <p className="text-sm font-bold truncate">{nowPlayingTitle || 'Waiting music'}</p>
              </div>
              {queueLength > 1 ? (
                <button type="button" onClick={onNext} disabled={busy} className="min-h-[40px] px-3 rounded-xl bg-white border border-black/10 text-xs font-bold flex items-center gap-1 disabled:opacity-60">
                  <SkipForward size={14} aria-hidden /> Next
                </button>
              ) : null}
              <button type="button" onClick={onStop} disabled={busy} className="min-h-[40px] px-3 rounded-xl bg-red-600 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-60">
                <Square size={12} aria-hidden /> Stop
              </button>
            </div>
            <label className="flex items-center gap-3 text-xs font-semibold text-gray-600">
              Volume
              <input
                type="range"
                min={HUDDLE_MUSIC_MIN_VOLUME}
                max={HUDDLE_MUSIC_MAX_VOLUME}
                step={0.01}
                value={volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                className="flex-1 accent-[#7a1f2b]"
                aria-label="Music volume"
              />
            </label>
          </div>
        ) : null}

        {error ? <p className="mt-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">{error}</p> : null}

        {playable.length > 1 ? (
          <button
            type="button"
            onClick={onPlayAll}
            disabled={busy}
            className="mt-4 w-full min-h-[48px] rounded-2xl bg-burgundy text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <ListMusic size={18} aria-hidden /> Play all ({playable.length} songs)
          </button>
        ) : null}

        <ul className="mt-3 divide-y divide-black/5">
          <li className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate">Waiting music</p>
              <p className="text-xs text-gray-500">The church’s default loop</p>
            </div>
            <PlayButton active={playing && nowPlayingId === DEFAULT_SONG_ID} busy={busy} onClick={() => onPlay(DEFAULT_SONG_ID)} />
          </li>
          {loading ? (
            <li className="py-4 flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Loading songs…
            </li>
          ) : (
            (songs || []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{s.title}</p>
                  <p className="text-xs text-gray-500 truncate">{[s.artist, mins(s.durationSeconds)].filter(Boolean).join(' · ')}</p>
                </div>
                {s.url ? <PlayButton active={playing && nowPlayingId === s.id} busy={busy} onClick={() => onPlay(s.id)} /> : null}
              </li>
            ))
          )}
        </ul>
        {!loading && songs && songs.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400 text-center">Add more songs in PLCC Canaan → More → Ka Link Music.</p>
        ) : null}
      </div>
    </div>
  );
}

function PlayButton({ active, busy, onClick }: { active: boolean; busy: boolean; onClick: () => void }) {
  return active ? (
    <span className="min-h-[36px] px-3 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center">Playing</span>
  ) : (
    <button type="button" onClick={onClick} disabled={busy} className="min-h-[36px] px-3 rounded-xl bg-burgundy/10 text-burgundy text-xs font-bold flex items-center gap-1 disabled:opacity-60">
      <Play size={13} aria-hidden /> Play
    </button>
  );
}
