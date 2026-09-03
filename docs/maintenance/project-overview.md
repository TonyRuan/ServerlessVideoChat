# Project Overview

`ServerlessVideoChat` is a static SPA for peer-to-peer video chat with one same-origin Cloudflare Pages Function for short-lived TURN credentials. It has no custom media backend: PeerJS provides signaling, and browser WebRTC carries audio, video, data-channel messages, reactions, diagnostics, and reconnect/session metadata. The Function never receives media or chat content.

## Stack

- React 18 + TypeScript + Vite
- React Router DOM v7
- PeerJS + WebRTC
- Zustand for local chat/reaction state
- Tailwind CSS, `clsx`, `tailwind-merge`
- Lucide React icons

## Routes And Session Shape

- `/`: home page with optional local preview, create meeting, and join meeting.
- `/call#session=<id>&role=host`: host waiting page.
- `/call/:remotePeerId#session=<id>&role=guest`: guest joins a specific Peer ID.
- Device sessions reuse `/call` with `mode=device` and an authenticated pairing secret in the URL hash. Pair metadata is then stored locally for future direct opening.

Session state lives in the URL hash. Do not move meeting recovery state to long-term browser storage without an explicit privacy/product decision.

The creator's camera and microphone state is also part of the session contract. Disabled defaults are encoded as `audio=0` and `video=0`; omitted values remain enabled for old-link compatibility. Voice-only and text-only direct invites therefore start guests with the same disabled devices as the host.

The home page accepts only a complete HTTP/HTTPS invite URL whose route, peer ID, session ID, and guest role are valid. Bare Peer IDs are rejected so a join attempt cannot silently invent an unrelated session.

Home does not request camera or microphone permission on page load. Its media buttons set the future meeting defaults before a stream exists; the explicit preview command requests only the currently enabled devices. This keeps pasted voice-only and text-only invite flows from prompting for devices before their invite defaults are known.

## User-Facing Capabilities

- Cross-device P2P audio/video calls.
- Local media controls, quality switching, and video fit mode.
- Session-level initial media defaults for video, voice-only, and text-only meetings; disabled hardware is requested only when a participant later enables it.
- Encrypted text/image chat plus confirmation-first file transfer over separate WebRTC control and bulk DataConnections. Regular meetings remain memory-only. Explicitly paired device sessions persist their capped text/image history, drafts, and local custom device names, queue offline text/images, and authenticate key exchange with the pairing secret.
- Double-click dog emoji reactions.
- Compact diagnostics panel with expandable full debug details.
- Invite link with QR code for phone join flow.
- TURN candidates enabled by default, preferring short-lived same-origin credentials with complete static credentials as migration/local fallback.
- Bounded automatic recovery for media, chat control, and bulk file transports, with relay-only escalation after repeated media establishment failure.
- Independent PeerServer signaling recovery that preserves healthy P2P transports, pauses ordinary meetings after bounded retries, and keeps paired-device retries active while the app screen remains active.

## Important Modules

- `src/pages/CallPage.tsx`: central call page coordinator. It is intentionally risky to change broadly; prefer focused edits or extract small components/hooks when a task requires it.
- `src/hooks/usePeer.ts`: PeerJS lifecycle, media calls, data connections, RTC config, and SDP transform.
- `src/hooks/useMediaStream.ts`: camera/microphone acquisition and quality changes.
- `src/lib/mediaDevicePolicy.ts`: selective device constraints and hardware-free placeholder tracks for initially disabled media.
- `src/hooks/useAutoHideControls.ts`: call-control visibility and activity timeout behavior.
- `src/lib/callSession.ts`: session parsing, link creation, hash updates.
- `src/lib/devicePairing.ts`: stable device identity, pairing secret, and paired-device records.
- `src/lib/runtimeUrls.ts`: hosted invite and native TURN endpoint resolution.
- `src/lib/fileTransferBinary.ts`: binary file frame encoding and validation.
- `src/lib/fileTransferFlow.ts`: receiver credit, sender window, ACK, and resume helpers.
- `src/lib/realtimeProtocol.ts`: strict validation for quality and reaction payloads.
- `src/lib/iceConfig.ts`: ICE server and TURN mode generation.
- `src/lib/turnCredentials.ts`: dynamic credential validation, refresh timing, and static fallback resolution.
- `src/lib/connectionRecovery.ts`: transport deadlines, reconnect backoff, and TURN mode escalation.
- `src/lib/peerErrorPolicy.ts`: PeerJS error classification and signaling retry timing.
- `src/lib/mediaErrorPolicy.ts`: user-facing camera/microphone error classification.
- `src/lib/transportWatchdog.ts`: cancellable data-transport watchdog wiring.
- `src/lib/turnFallback.ts`: user-facing recovery status labels.
- `src/lib/mediaStats.ts`: stats parsing for codec, bitrate, bandwidth, and TURN usage.
- `src/components/NetworkDiagnosticsPanel.tsx`: collapsed/expanded diagnostics panel.
- `src/components/InviteLinkCard.tsx`: invite link, copy action, QR code.
- `src/components/CallControls.tsx`: desktop/mobile call controls and accessible control state.
- `src/components/CallIssuePanel.tsx`: blocking terminal or media-setup errors with recovery actions.
- `src/components/ConnectionStatusNotice.tsx`: non-blocking signaling, transport, and device recovery notices.
- `functions/api/turn-credentials.ts`: same-origin coturn REST credential issuer for Cloudflare Pages.

## Known Risks

- `CallPage.tsx` has broad responsibilities. Avoid unrelated refactors inside it.
- Static TURN credentials injected through `VITE_*` remain visible in frontend build output and are only a fallback. Production should use the Pages Function and remove static credentials after coturn migration is verified.
- Dynamic TURN issuance depends on Cloudflare Pages bindings and matching coturn shared-secret configuration; migrate both sides in one controlled window.
- WebRTC connection success still depends on browser, network, NAT, firewall, TURN reachability, and media permission.
- Regular meeting chat remains memory-only. Paired-device text/image history is deliberately local and is lost when site/app storage is cleared; file bytes and file handles are never persisted.
- Invite URLs are bearer capabilities and do not independently verify the other participant's identity.
- Non-image files are capped at 2GiB, but unsupported browsers still cap the memory-backed download fallback at 10MiB.
- Browser UI validation may stop at a permission-denied screen unless fake media devices or explicit user permission are available.
- Android v1 reconnects only while its screen is active; it has no push notifications, cloud queue, or background service.

## Documentation Maintenance

When behavior changes, update the most specific maintenance doc:

- Build/deploy or hosting: `docs/maintenance/deployment.md`
- Environment variables or secrets: `docs/maintenance/environment.md`
- PeerJS/WebRTC/TURN/fallback: `docs/maintenance/webrtc.md`
- Tests or verification workflow: `docs/maintenance/testing.md`
- Git, branch, commit, push workflow: `docs/maintenance/git.md`
- Product structure, routes, major modules, risks: this file

Then update `.codex/PROJECT_CONTEXT.md` if its concise summary becomes stale.
