import type { CapacitorConfig } from '@capacitor/cli';

/**
 * #21 — PLCC Ka Link on the App Store and Play Store (Nov 2026).
 *
 * The phone app opens the live Ka Link site (server.url), so every fix we push
 * to main reaches app users right away — no store review for normal updates.
 * The native shell adds what a website can't do: keep a Ka Link going in the
 * background with an "On Ka Link" notification (Android), background audio and
 * mic/camera permissions (iPhone).
 *
 * appId is permanent once the app is uploaded to a store — change it before the
 * first upload if PLCC wants a different one.
 */
const config: CapacitorConfig = {
  appId: 'org.promisedlandcc.kalink',
  appName: 'PLCC Ka Link',
  webDir: 'dist',
  server: {
    url: 'https://plcc-chat.vercel.app',
    // Sign-in and the church's other apps open inside the app instead of Safari/Chrome.
    allowNavigation: [
      'plcc-chat.vercel.app',
      'plcc-opal.vercel.app',
      'plcc-connect.vercel.app',
      '*.supabase.co',
    ],
  },
  backgroundColor: '#0e1512',
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
