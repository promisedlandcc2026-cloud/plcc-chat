/**
 * #21 — PLCC Ka Link as a real phone app (Capacitor shell around this site).
 *
 * In the browser / home-screen web app, everything here does nothing.
 * In the store app:
 *  - Android: KaLinkCall.start shows the "On Ka Link" notification, which lets
 *    the call (mic and sound) keep going in the background. stop removes it.
 *  - iPhone: the app has background audio, so members keep hearing the prayer;
 *    there is no Android-style service, so start/stop quietly do nothing.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

type KaLinkCallPlugin = {
  start(opts: { title: string }): Promise<void>;
  stop(): Promise<void>;
};

const KaLinkCall = registerPlugin<KaLinkCallPlugin>('KaLinkCall');

/** True inside the App Store / Play Store app. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  try {
    const p = Capacitor.getPlatform();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}

let running = false;

/** A Ka Link is live on this phone: keep it going in the background. */
export async function startNativeCall(title: string): Promise<void> {
  if (nativePlatform() !== 'android') return;
  try {
    await KaLinkCall.start({ title: title || 'Live Ka Link' });
    running = true;
  } catch {
    /* older app build without the plugin — the call still works in the foreground */
  }
}

export async function stopNativeCall(): Promise<void> {
  if (!running || nativePlatform() !== 'android') return;
  running = false;
  try {
    await KaLinkCall.stop();
  } catch {
    /* ignore */
  }
}
