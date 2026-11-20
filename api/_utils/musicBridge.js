/**
 * Ka Link Music from the phone apps (Nov 19 2026): the music team (and managers)
 * list, upload, rename-free confirm and delete songs. Canaan decides who may.
 * Same file in Ka Link and PLCC Tribes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIMES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg']);
const MAX_SONG_BYTES = 25 * 1024 * 1024;

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');

/** @param {unknown} raw */
export function parseMusicCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = /** @type {Record<string, unknown>} */ (raw);
  const action = String(b.action || 'list');
  if (action === 'list') {
    const cid = String(b.channelId || '').trim();
    return cid ? (UUID_RE.test(cid) ? { action, channelId: cid } : null) : { action };
  }
  if (action === 'upload-url') {
    if (b.purchased !== true) return null;
    const mime = String(b.mime || '').toLowerCase();
    const size = Number(b.size);
    if (!MIMES.has(mime) || !Number.isFinite(size) || size <= 0 || size > MAX_SONG_BYTES) return null;
    return {
      action,
      purchased: true,
      mime,
      size,
      filename: clip(b.filename, 200),
      title: clip(b.title, 120) || undefined,
      artist: clip(b.artist, 120) || undefined,
    };
  }
  if (action === 'confirm' || action === 'delete') {
    const songId = String(b.songId || '');
    if (!UUID_RE.test(songId)) return null;
    if (action === 'delete') return { action, songId };
    const d = Math.round(Number(b.durationSeconds));
    return { action, songId, ...(Number.isFinite(d) && d > 0 && d < 6 * 3600 ? { durationSeconds: d } : {}) };
  }
  return null;
}

const SIGNED_PLAY = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/sign\/[^\s"'<>]+$/i;
const SIGNED_UPLOAD = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/upload\/sign\/[^\s"'<>]+$/i;

/** Canaan's answer → only what the phone needs. */
export function sanitizeMusicAnswer(action, body) {
  if (action === 'upload-url') {
    const url = String(body?.signedUrl || '');
    if (!UUID_RE.test(String(body?.songId || '')) || !SIGNED_UPLOAD.test(url) || url.length > 2000) return null;
    return { songId: String(body.songId), signedUrl: url };
  }
  if (action !== 'list') return {};
  const songs = Array.isArray(body?.songs)
    ? body.songs.slice(0, 300).flatMap((s) => {
        if (!s || typeof s !== 'object' || !UUID_RE.test(String(s.id || ''))) return [];
        const url = String(s.url || '');
        return [
          {
            id: String(s.id),
            title: typeof s.title === 'string' ? s.title.slice(0, 120) : 'Untitled song',
            artist: typeof s.artist === 'string' ? s.artist.slice(0, 120) : null,
            durationSeconds: Number(s.durationSeconds) > 0 ? Math.round(Number(s.durationSeconds)) : null,
            url: SIGNED_PLAY.test(url) && url.length < 2000 ? url : null,
            mine: s.mine === true,
          },
        ];
      })
    : [];
  return { songs, canManage: body?.canManage === true, canManageTeam: body?.canManageTeam === true };
}
