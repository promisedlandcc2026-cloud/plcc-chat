/**
 * Live Huddle shared waiting music (mirrors PLCC Canaan api/_utils/huddleMusic.ts).
 *
 * Channel moderators and the session host may play a looping track into the
 * same LiveKit room as voice. Everyone in the huddle hears it, whether they
 * joined from Connect or the Vault.
 */

/** Play Music is available when the local user is a channel mod or session host. */
export function canControlHuddleMusic(canModerate: boolean): boolean {
  return Boolean(canModerate);
}

/** LiveKit track name — must match the Vault so both apps see the same music. */
export const HUDDLE_MUSIC_TRACK_NAME = 'awc-huddle-music';

/** Church-supplied loop, same file as the Vault's public/huddle/waiting.mp3. */
export const HUDDLE_MUSIC_ASSET_PATH = '/huddle/waiting.mp3';

/** Quieter than speech so voices stay clear. */
export const HUDDLE_MUSIC_DEFAULT_VOLUME = 0.18;
export const HUDDLE_MUSIC_MIN_VOLUME = 0.05;
export const HUDDLE_MUSIC_MAX_VOLUME = 0.6;

export function clampHuddleMusicVolume(next: unknown): number {
  const n = Number(next);
  if (!Number.isFinite(n)) return HUDDLE_MUSIC_DEFAULT_VOLUME;
  return Math.min(HUDDLE_MUSIC_MAX_VOLUME, Math.max(HUDDLE_MUSIC_MIN_VOLUME, n));
}

export type HuddleMusicPublicationLike = {
  trackName?: string | null;
  name?: string | null;
};

export function isHuddleMusicPublication(pub: HuddleMusicPublicationLike | null | undefined): boolean {
  if (!pub) return false;
  const name = String(pub.trackName || pub.name || '').trim();
  return name === HUDDLE_MUSIC_TRACK_NAME;
}

export function roomHasHuddleMusic(
  publications: Array<HuddleMusicPublicationLike | null | undefined>
): boolean {
  return (publications || []).some((p) => isHuddleMusicPublication(p));
}

export function huddleMusicButtonLabel(playing: boolean, activeElsewhere = false): string {
  if (playing) return 'Stop Music';
  if (activeElsewhere) return 'Music On';
  return 'Play Music';
}

export function formatHuddleMusicError(err: unknown): string {
  const name = String((err as { name?: string })?.name || '');
  const msg = String((err as { message?: string })?.message || err || '');
  const lower = `${name} ${msg}`.toLowerCase();
  if (
    lower.includes('not installed') ||
    lower.includes('failed to load') ||
    lower.includes('no supported source') ||
    lower.includes('media_err') ||
    lower.includes('404') ||
    lower.includes('networkerror')
  ) {
    return 'Waiting music file is not installed.';
  }
  if (lower.includes('capturestream') || lower.includes('not supported')) {
    return 'Background music is not available in this browser.';
  }
  if (lower.includes('already playing') || lower.includes('already active')) {
    return 'Music is already playing.';
  }
  if (lower.includes('abort') || lower.includes('cancel') || lower.includes('notallowed')) {
    return 'Could not start waiting music.';
  }
  return msg.trim() || 'Could not start waiting music.';
}

/**
 * Key for remote audio elements — one per track, so a host's voice and the
 * music they play don't share (and overwrite) the same element.
 */
export function huddleRemoteAudioKey(identity: string, trackSid: string | null | undefined): string {
  const id = String(identity || '').trim() || 'unknown';
  const sid = String(trackSid || '').trim();
  return sid ? `${id}:${sid}` : id;
}
