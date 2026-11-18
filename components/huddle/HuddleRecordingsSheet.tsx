import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Mic, Play, Trash2, X } from 'lucide-react';
import {
  deleteHuddleRecording,
  getHuddleRecordingUrl,
  listHuddleRecordings,
  type KaLinkRecording,
} from '../../lib/communityChatClient';

/**
 * #14 Ka Link recordings: past prayer sessions of this room (e.g. Midnight Watch),
 * played back with a short-lived private link. Moderators may delete.
 */

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function length(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`;
}

export function HuddleRecordingsSheet({
  channelId,
  roomName,
  canDelete,
  onClose,
}: {
  channelId: string;
  roomName?: string;
  canDelete: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<KaLinkRecording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await listHuddleRecordings(channelId);
      setItems(r.recordings);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Could not load recordings.');
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const play = async (rec: KaLinkRecording) => {
    setBusyId(rec.id);
    setError(null);
    try {
      setPlaying({ id: rec.id, url: await getHuddleRecordingUrl(channelId, rec.id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that recording.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (rec: KaLinkRecording) => {
    if (!window.confirm(`Delete the recording from ${when(rec.startedAt)}? This cannot be undone.`)) return;
    setBusyId(rec.id);
    try {
      await deleteHuddleRecording(channelId, rec.id);
      if (playing?.id === rec.id) setPlaying(null);
      setItems((prev) => (prev || []).filter((r) => r.id !== rec.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that recording.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="pr-sheet-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Recordings" className="pr-sheet" onClick={(e) => e.stopPropagation()} data-testid="huddle-recordings">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-lg font-extrabold">
            <span className="pr-info-icon"><Mic size={16} aria-hidden /></span>
            Recordings{roomName ? ` · ${roomName}` : ''}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-black/5 flex items-center justify-center">
            <X size={18} aria-hidden />
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">{error}</p>
        ) : null}

        {items === null ? (
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="mt-6 text-center text-sm text-gray-500">No recordings yet. A moderator can tap Record during a Ka Link.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {items.map((rec) => (
              <li key={rec.id} className="rounded-2xl border border-black/10 bg-white p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{when(rec.startedAt)}</p>
                    <p className="text-xs text-gray-500">
                      {rec.status === 'recording'
                        ? '● Recording now'
                        : rec.status === 'processing'
                          ? 'Getting ready… (a few minutes)'
                          : [length(rec.durationSeconds), rec.startedByName ? `by ${rec.startedByName}` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {rec.status === 'ready' ? (
                    <button
                      type="button"
                      onClick={() => void play(rec)}
                      disabled={busyId === rec.id}
                      className="min-h-[40px] px-3 rounded-xl bg-burgundy text-white text-xs font-bold flex items-center gap-1 disabled:opacity-60"
                    >
                      {busyId === rec.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />} Play
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => void remove(rec)}
                      disabled={busyId === rec.id}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-red-50 text-red-600 flex items-center justify-center disabled:opacity-60"
                      aria-label="Delete recording"
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  ) : null}
                </div>
                {playing?.id === rec.id ? (
                  <div className="mt-3 space-y-2">
                    <audio src={playing.url} controls autoPlay preload="metadata" className="w-full" />
                    <a href={playing.url} download className="inline-flex items-center gap-1 text-xs font-bold text-burgundy min-h-[32px]">
                      <Download size={13} aria-hidden /> Download
                    </a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] text-gray-400 text-center">Recordings are private to people who can open this room.</p>
      </div>
    </div>
  );
}
