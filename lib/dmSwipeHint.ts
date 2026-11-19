/**
 * One-time hints that DM rows can be swiped left to delete.
 * Per device: the peek animation plays once; the tip stays until "Got it" or a real swipe.
 */
const PEEK_KEY = 'plcc.kaLink.dmSwipePeek.v1';
const TIP_KEY = 'plcc.kaLink.dmSwipeTip.v1';

const read = (k: string) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return true; // private mode: don't nag
  }
};
const write = (k: string) => {
  try {
    localStorage.setItem(k, '1');
  } catch {
    /* ignore */
  }
};

export const hasSeenSwipePeek = () => read(PEEK_KEY);
export const markSwipePeekSeen = () => write(PEEK_KEY);
export const hasDismissedSwipeTip = () => read(TIP_KEY);
export const dismissSwipeTip = () => write(TIP_KEY);

/** Phones/tablets get "swipe"; mouse users get "right-click". */
export const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
