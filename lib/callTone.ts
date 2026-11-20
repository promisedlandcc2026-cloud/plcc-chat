/**
 * Call sounds made in the browser (no audio files to download):
 *  - ringtone: incoming call (two short rings, then a pause) + vibration on phones
 *  - ringback: what the caller hears while it rings (soft "brr… brr…")
 * Browsers only allow sound after the person has touched the page once; if a
 * phone blocks it, the vibration and the call screen still show the call.
 */
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export type CallTone = { stop: () => void };

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, freqs: number[], start: number, length: number, volume: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + length - 0.04);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(ctx.destination);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + length);
  }
}

function loop(pattern: (ctx: AudioContext, at: number) => void, everyMs: number, vibrate?: number[]): CallTone {
  const ctx = audioContext();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (ctx) {
      void ctx.resume().catch(() => {});
      pattern(ctx, ctx.currentTime + 0.05);
    }
    if (vibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(vibrate);
      } catch {
        /* not allowed */
      }
    }
  };
  tick();
  const timer = window.setInterval(tick, everyMs);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(0);
      } catch {
        /* ignore */
      }
      void ctx?.close().catch(() => {});
    },
  };
}

export function startRingtone(): CallTone {
  return loop(
    (ctx, at) => {
      beep(ctx, [880, 1320], at, 0.35, 0.18);
      beep(ctx, [880, 1320], at + 0.5, 0.35, 0.18);
    },
    2600,
    [400, 150, 400]
  );
}

export function startRingback(): CallTone {
  return loop((ctx, at) => beep(ctx, [440, 480], at, 1.2, 0.06), 3500);
}
