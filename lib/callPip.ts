/** The floating call window's video element, so the "Float" button can open it. */
type PipVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
};

let current: PipVideo | null = null;

export function registerPipVideo(el: HTMLVideoElement): () => void {
  current = el as PipVideo;
  return () => {
    if (current === el) current = null;
  };
}

/** Can this browser float a video (Chrome / Edge / Android: picture-in-picture; iPhone Safari: presentation mode)? */
export function pipSupported(): boolean {
  if (typeof document === 'undefined') return false;
  if ((document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled) return true;
  const probe = document.createElement('video') as PipVideo;
  return typeof probe.webkitSupportsPresentationMode === 'function' && probe.webkitSupportsPresentationMode('picture-in-picture');
}

/** Float the call (must run from a tap). Returns false when the browser said no. */
export async function enterCallPip(): Promise<boolean> {
  const el = current;
  if (!el) return false;
  try {
    if (el.paused) await el.play().catch(() => {});
    if (typeof el.requestPictureInPicture === 'function' && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled) {
      await el.requestPictureInPicture();
      return true;
    }
    if (typeof el.webkitSetPresentationMode === 'function') {
      el.webkitSetPresentationMode('picture-in-picture');
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
