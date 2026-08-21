# ServerlessVideoChat Codex Context

> Keep this file concise. Update the relevant `docs/maintenance/*` document first, then keep this summary aligned.
> Last synced: 2026-08-21.

## What This Project Is

`ServerlessVideoChat` is a static SPA for P2P video chat plus a same-origin Cloudflare Pages Function that issues short-lived TURN credentials. PeerJS handles signaling. Browser WebRTC carries audio, video, encrypted chat payloads, dog emoji reactions, quality changes, diagnostics, and reconnect/session metadata; the Function never receives media or chat content.

Primary stack:

- React 18 + TypeScript + Vite
- React Router DOM v7
- PeerJS + WebRTC
- Zustand
- Tailwind CSS
- Capacitor 8 Android wrapper

## Current Behavior To Remember

- Main routes are `/` and `/call/:remotePeerId?`.
- Meeting recovery and initial media defaults live in the URL hash, for example `#session=...&role=host&video=0`. Missing `audio`/`video` parameters default to enabled for backward compatibility.
- The host's camera/microphone state at creation becomes the guest default. Voice-only joins request only a microphone; text-only joins request no device. Disabled placeholder tracks reserve PeerJS senders so a later manual enable requests and replaces only that device.
- Home media preview is explicit rather than automatic; pre-preview controls only set defaults, so pasted text/voice invites do not trigger unrelated device permission prompts.
- The home join form accepts only a complete valid HTTP/HTTPS invite URL; bare Peer IDs are rejected.
- Regular meeting chat is memory-only. Explicit paired-device sessions persist capped text/image history and drafts locally, queue offline text/images, and keep retrying while the app screen is active; non-image files remain online-only.
- Device pairing stores a stable local PeerJS id and pairing secret. The secret authenticates ECDH key messages and is mixed into the AES-GCM key derivation; encrypted message ACKs drive pending/sent state.
- Default TURN mode is `on`, so complete TURN configuration adds candidates during initial ICE gathering. A valid `/api/turn-credentials` response is preferred; complete static `VITE_TURN_*` values are migration/local fallback.
- URL query/hash and `VITE_TURN_MODE` can still disable TURN or force relay-only diagnostics.
- Media/control/bulk transports use 15-second establishment deadlines, 5-second disconnected grace, immediate failed-state recovery, and six guest-only retries with jitter. Repeated media establishment failure can promote future connections from `on` to relay-only `force`; host remains passive.
- Only the guest initiates media/control/bulk connections. The host accepts incoming connections only when session, role, channel, and actual PeerJS peer identity match; active connections cannot be replaced by an unsolicited duplicate.
- The left-top diagnostics panel is compact by default and expands to separate media/chat/file states, selected TURN usage, and credential source/expiry without showing credential material.
- New meeting invite UI includes both a share link and a QR code.
- Chat supports text, image previews, and confirmation-first non-image file transfer. Control and bulk traffic use separate encrypted DataConnections; the receiver grants a 1MiB credit window, acknowledges completion only after writing the file, and advertises its persisted offset after a reconnect. Raw file frames are 256KiB, files are capped at 2GiB, and browsers without direct disk save support cap memory fallback at 10MiB.
- Chat history is capped at 200 in-memory messages and evicted `blob:` download URLs are revoked.

## Maintenance Docs

- `AGENTS.md`: short AI-agent entrypoint and non-negotiable rules.
- `docs/maintenance/project-overview.md`: routes, capabilities, modules, known risks.
- `docs/maintenance/environment.md`: `.env.local`, variable names, SSH server access, secret handling.
- `docs/maintenance/webrtc.md`: PeerJS, WebRTC, TURN modes, fallback, diagnostics.
- `docs/maintenance/testing.md`: required and focused verification commands.
- `docs/maintenance/deployment.md`: Cloudflare Pages and GitHub Pages deploy flows.
- `docs/maintenance/git.md`: staging, committing, pushing, safe directory workaround.
- `docs/maintenance/android.md`: Capacitor scope, toolchain, debug APK build, and emulator QA.

## Key Files

- `src/pages/CallPage.tsx`: main call UI and orchestration.
- `src/hooks/usePeer.ts`: PeerJS lifecycle and RTC config.
- `src/hooks/useMediaStream.ts`: local media acquisition and quality switching.
- `src/lib/mediaDevicePolicy.ts`: selective device constraints and hardware-free disabled tracks.
- `src/hooks/useAutoHideControls.ts`: call-control auto-hide behavior.
- `src/lib/iceConfig.ts`: STUN/TURN config and TURN mode parsing.
- `src/lib/turnCredentials.ts`: dynamic credential validation, refresh, and static fallback.
- `src/lib/connectionRecovery.ts`: deadlines, retry jitter, and TURN escalation.
- `src/lib/transportWatchdog.ts`: data-transport watchdog lifecycle.
- `src/lib/turnFallback.ts`: connection-recovery status labels.
- `src/lib/callSession.ts`: URL session parsing and invite links.
- `src/lib/devicePairing.ts`: stable identity and paired-device records.
- `src/lib/runtimeUrls.ts`: hosted invite and native TURN endpoint selection.
- `src/lib/callConnectionPolicy.ts`: call role, metadata, replacement, and peer-binding policy.
- `src/lib/fileTransferBinary.ts`: binary file frames.
- `src/lib/fileTransferFlow.ts`: credit, ACK, and resume calculations.
- `src/lib/realtimeProtocol.ts`: strict realtime payload validation.
- `src/lib/mediaStats.ts`: codec, bitrate, bandwidth, TURN usage stats.
- `src/components/NetworkDiagnosticsPanel.tsx`: compact/expanded debug panel.
- `src/components/InviteLinkCard.tsx`: share link and QR code.
- `src/components/ChatPanel.tsx`: encrypted chat UI, image preview attachments, and file download cards.
- `src/components/CallControls.tsx`: accessible desktop/mobile call controls.
- `functions/api/turn-credentials.ts`: coturn REST credential issuer for Cloudflare Pages.

## Commands

Local development:

```powershell
npm install
npm run dev
```

Required verification before code changes are called ready:

```powershell
npm test
npm run check
npm run lint
npm run build
```

Cloudflare Pages deploy details are in `docs/maintenance/deployment.md`. Do not print or commit `.env.local` values.

Server SSH access details are in `docs/maintenance/environment.md`. Do not print or commit private keys, SSH passwords, or cloud access keys.

## Known High-Risk Areas

- `CallPage.tsx` has many responsibilities; keep edits scoped.
- Static TURN `VITE_*` credentials become frontend-visible build data. Production should remove them only after Pages/coturn short-lived credential and forced-relay verification.
- Current coturn infrastructure was observed on 2026-07-13 without TLS 443 and with a narrow relay range; do not perform a partial auth migration before DNS, certificate, and firewall prerequisites are ready.
- Production `v0.0.8` was deployed on 2026-07-14. The credential Function route is live but returns `503` until Pages shared-secret bindings are configured, so production currently uses the static TURN fallback; coturn itself was not changed.
- WebRTC behavior depends on real browser/network/media permission state.
- Cloudflare Pages uses root-path hosting; GitHub Pages uses `/ServerlessVideoChat/`.
- Do not approve camera/microphone browser prompts unless the user explicitly authorizes it.
- Android v1 has no background service, push notification, or cloud queue. App data clearing removes pairing and history.
