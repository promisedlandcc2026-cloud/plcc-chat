# PLCC Ka Link — App Store & Play Store (#21)

The phone app is a native shell (Capacitor) around the live site
**https://plcc-chat.vercel.app**. Anything pushed to `main` reaches app users
right away; a new store version is only needed when the native parts change
(`android/`, `ios/`, `capacitor.config.ts`).

What the app adds over the website
- **Android:** an "On Ka Link" notification while in a call, so mic and sound
  keep going when members switch apps or lock the phone.
- **iPhone:** background audio, so members keep *hearing* the prayer in the
  background. iPhone still pauses the *mic* when the app is in the background
  (they show as "Listening in background" and come back muted).
- Real app icon and splash, mic/camera permission prompts, no browser bar.

App ID: `org.promisedlandcc.kalink` — permanent after the first store upload.

## Test on Android now (no accounts needed)
1. GitHub → **Actions → Android app** → latest run → download
   **plcc-ka-link-android-test** (a zip with `app-debug.apk`).
2. On the Android phone, open the APK and allow "install unknown apps".

## Google Play
1. Google Play Console account for PLCC ($25 one-time): https://play.google.com/console
2. Create an upload key once (keep it safe — losing it is painful):
   `keytool -genkey -v -keystore plcc-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias plcc`
3. Add repository secrets: `ANDROID_KEYSTORE_BASE64` (`base64 -w0 plcc-upload.jks`),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`plcc`), `ANDROID_KEY_PASSWORD`.
4. Re-run **Android app**; download **plcc-ka-link-play-store** (`.aab`) and upload it
   to an Internal testing track, then Production.
5. Play listing needs: privacy policy URL, screenshots, content rating, and the
   foreground-service declaration ("microphone — ongoing voice calls").

## Apple App Store
1. Apple Developer Program for PLCC ($99/year): https://developer.apple.com/programs/
   (as an organization it needs a D-U-N-S number).
2. Build needs a Mac with Xcode (or a cloud Mac service such as Codemagic):
   `npm ci && npm run app:sync && npx cap open ios` → set the Team → Product → Archive
   → upload to App Store Connect → TestFlight → submit.
3. App Store listing needs: privacy policy URL, screenshots, and a demo sign-in
   for Apple's reviewer (they must be able to get into a Ka Link).

## Changing icons
Replace `assets/icon-only.png` (1024×1024, no transparency) and run `npm run app:assets`.
