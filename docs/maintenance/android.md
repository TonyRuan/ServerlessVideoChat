# Android App

The Android client is a Capacitor 8 wrapper around the same Vite build. Its package id is `com.tonyruan.serverlessvideochat`, app name is `SVC 设备桥`, minimum Android version is API 26, and the committed native project lives under `android/`.

## First-Version Scope

- Pair two devices once with a QR code or pasted device invite.
- Keep a stable local PeerJS id, paired-device metadata, locally customized display names, text/image history, drafts, and unsent text/image messages in local storage.
- Authenticate the device ECDH exchange with the pairing secret before deriving the AES-GCM chat key. A received chat message is marked sent only after an encrypted acknowledgement.
- Retry the paired device connection indefinitely while the device screen is open. This is not an Android background service and there are no push notifications or cloud message queues.
- Queue text and inline images while the other device is offline. Non-image files require both devices to be online; file handles and partial files are not persisted across an app restart.
- Regular meeting links retain their existing ephemeral behavior and do not persist chat history.

Device pairing links are bearer capabilities. Treat their QR codes and full URL hashes like secrets. Unpairing removes the stored pairing record on the current device; it does not remotely erase the other device.

## Toolchain

Capacitor 8 uses JDK 21 and Android SDK 36. This workstation has a portable setup at:

```text
E:\TR\misc\ARrecord\.tools\jdk-21
E:\TR\misc\ARrecord\.tools\android-sdk
```

`android/local.properties` is ignored and must point at the local SDK. Do not commit machine-specific SDK paths.

## Build A Debug APK

For every installable Android update, increment `versionCode` in
`android/app/build.gradle` and keep `versionName` aligned with the web package
version. Android uses the monotonically increasing `versionCode` to decide
whether an installed app can be upgraded in place.

```powershell
npm install
npm run android:sync

$env:JAVA_HOME = 'E:\TR\misc\ARrecord\.tools\jdk-21'
$env:ANDROID_HOME = 'E:\TR\misc\ARrecord\.tools\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Push-Location android
.\gradlew.bat assembleDebug --console=plain
Pop-Location
```

The result is `android/app/build/outputs/apk/debug/app-debug.apk`. It is debug-signed and suitable for local installation only. A distributable release still needs an explicit versioning, keystore, signing, backup, and upgrade policy.

## Runtime URLs And TURN

The WebView origin is `https://localhost`, which is not a shareable URL. Native invite links therefore default to `https://chat.uavserver.cn/`, and the native TURN request defaults to `https://chat.uavserver.cn/api/turn-credentials`.

- `VITE_PUBLIC_APP_URL` overrides the hosted URL used in native pairing links.
- `VITE_TURN_CREDENTIALS_URL` still overrides the credential endpoint.
- The Pages Function accepts only same-origin requests plus Capacitor's narrow trusted origins (`https://localhost` and `capacitor://localhost`) and returns a matching CORS header for those native origins.

If the Android build is released before the updated Pages Function is deployed, direct/STUN connections still work, but the native client cannot use dynamic TURN credentials. Keep the website and APK protocol versions compatible during rollout.

## Android QA

Use the `ARrecord_API35` emulator and derive tap coordinates from a fresh UI hierarchy rather than hardcoding them. A minimum smoke test is:

1. Install the debug APK with `adb install -r`.
2. Launch `com.tonyruan.serverlessvideochat/.MainActivity`.
3. Confirm the home page shows `我的设备` and `配对新设备`.
4. Create a device pairing and confirm the URL starts with the hosted public app URL, not `https://localhost`.
5. Rename a paired device, force-stop and relaunch, then confirm the custom name and paired-device card are still present.
6. Inspect the crash buffer and relevant logcat errors.

Do not grant camera or microphone permissions during this smoke test. Text-only device pairing does not need them. QR scanning needs camera permission and should be tested only when permission testing is explicitly in scope.

## Current Platform Limitations

- Android has no persisted `FileSystemFileHandle`; non-image files remain online-only.
- The WebView does not provide desktop `showSaveFilePicker`. Receive flows use the existing memory fallback and therefore reject files over 10MiB.
- Pairing/history storage is local to the WebView app data and is lost if Android app data is cleared or the app is uninstalled.
- There is no background reconnect after the OS suspends or kills the app.
