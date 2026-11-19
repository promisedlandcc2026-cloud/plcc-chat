/**
 * #21 — PLCC Ka Link on the App Store and Play Store (Capacitor shell).
 * Run: node --test scripts/ka-link-store-app.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('Store app shell', () => {
  it('opens the live Ka Link site so updates need no store review', () => {
    const cfg = read('capacitor.config.ts');
    assert.match(cfg, /appId: 'org\.promisedlandcc\.kalink'/);
    assert.match(cfg, /appName: 'PLCC Ka Link'/);
    assert.match(cfg, /url: 'https:\/\/plcc-chat\.vercel\.app'/);
  });

  it('Android: mic, camera and the background call service', () => {
    const m = read('android/app/src/main/AndroidManifest.xml');
    for (const perm of ['RECORD_AUDIO', 'CAMERA', 'FOREGROUND_SERVICE_MICROPHONE', 'POST_NOTIFICATIONS']) {
      assert.match(m, new RegExp(`android\\.permission\\.${perm}`));
    }
    assert.match(m, /android:name="\.KaLinkCallService"[\s\S]*foregroundServiceType="microphone\|mediaPlayback"/);
    const dir = 'android/app/src/main/java/org/promisedlandcc/kalink';
    assert.match(read(`${dir}/MainActivity.java`), /registerPlugin\(KaLinkCallPlugin\.class\)/);
    assert.match(read(`${dir}/KaLinkCallPlugin.java`), /@CapacitorPlugin\(name = "KaLinkCall"\)/);
    assert.match(read(`${dir}/KaLinkCallService.java`), /FOREGROUND_SERVICE_TYPE_MICROPHONE/);
  });

  it('iPhone: mic/camera wording and background audio', () => {
    const plist = read('ios/App/App/Info.plist');
    assert.match(plist, /NSMicrophoneUsageDescription/);
    assert.match(plist, /NSCameraUsageDescription/);
    assert.match(plist, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>audio<\/string>/);
    assert.match(read('ios/App/App/AppDelegate.swift'), /setCategory\(\.playAndRecord, mode: \.voiceChat/);
    assert.ok(existsSync(join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset')));
  });

  it('the call screen starts and stops the background call', () => {
    const src = read('components/community/ConnectVoiceHuddle.tsx');
    assert.match(src, /void startNativeCall\(title\);\s*return \(\) => \{\s*void stopNativeCall\(\);/);
    assert.match(read('lib/nativeShell.ts'), /registerPlugin<KaLinkCallPlugin>\('KaLinkCall'\)/);
  });

  it('the store app counts as installed (no install prompt or "open in app" banner)', () => {
    assert.match(read('lib/installPrompt.ts'), /if \(isNativeApp\(\)\) return true;/);
  });

  it('a GitHub build makes an installable Android test app', () => {
    const wf = read('.github/workflows/android-app.yml');
    assert.match(wf, /assembleDebug/);
    assert.match(wf, /plcc-ka-link-android-test/);
  });
});
