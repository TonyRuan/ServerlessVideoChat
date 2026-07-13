# Project Overview

`ServerlessVideoChat` is a static SPA for peer-to-peer video chat. It has no custom media backend: PeerJS provides signaling, and browser WebRTC carries audio, video, data-channel messages, reactions, diagnostics, and reconnect/session metadata.

## Stack

- React 18 + TypeScript + Vite
- React Router DOM v7
- PeerJS + WebRTC
- Zustand for local chat/reaction state
- Tailwind CSS, `clsx`, `tailwind-merge`
- Lucide React icons

## Routes And Session Shape

- `/`: home page with local preview, create meeting, and join meeting.
- `/call#session=<id>&role=host`: host waiting page.
- `/call/:remotePeerId#session=<id>&role=guest`: guest joins a specific Peer ID.

Session state lives in the URL hash. Do not move meeting recovery state to long-term browser storage without an explicit privacy/product decision.

The home page accepts only a complete HTTP/HTTPS invite URL whose route, peer ID, session ID, and guest role are valid. Bare Peer IDs are rejected so a join attempt cannot silently invent an unrelated session.

## User-Facing Capabilities

- Cross-device P2P audio/video calls.
- Local media controls, quality switching, and video fit mode.
- Encrypted text/image chat plus confirmation-first file transfer over separate WebRTC control and bulk DataConnections. File transfer uses receiver-issued credit, reconnect resume, and a receiver completion acknowledgement; capable browsers save directly to disk, otherwise completed files become download cards. Chat is not persisted to local storage.
- Double-click heart reactions.
- Compact diagnostics panel with expandable full debug details.
- Invite link with QR code for phone join flow.
- TURN-enabled connection by default when TURN config is present, with URL/environment overrides.

## Important Modules

- `src/pages/CallPage.tsx`: central call page coordinator. It is intentionally risky to change broadly; prefer focused edits or extract small components/hooks when a task requires it.
- `src/hooks/usePeer.ts`: PeerJS lifecycle, media calls, data connections, RTC config, and SDP transform.
- `src/hooks/useMediaStream.ts`: camera/microphone acquisition and quality changes.
- `src/hooks/useAutoHideControls.ts`: call-control visibility and activity timeout behavior.
- `src/lib/callSession.ts`: session parsing, link creation, hash updates.
- `src/lib/fileTransferBinary.ts`: binary file frame encoding and validation.
- `src/lib/fileTransferFlow.ts`: receiver credit, sender window, ACK, and resume helpers.
- `src/lib/realtimeProtocol.ts`: strict validation for quality and reaction payloads.
- `src/lib/iceConfig.ts`: ICE server and TURN mode generation.
- `src/lib/turnFallback.ts`: fallback action derivation.
- `src/lib/mediaStats.ts`: stats parsing for codec, bitrate, bandwidth, and TURN usage.
- `src/components/NetworkDiagnosticsPanel.tsx`: collapsed/expanded diagnostics panel.
- `src/components/InviteLinkCard.tsx`: invite link, copy action, QR code.
- `src/components/CallControls.tsx`: desktop/mobile call controls and accessible control state.

## Known Risks

- `CallPage.tsx` has broad responsibilities. Avoid unrelated refactors inside it.
- TURN credentials injected through `VITE_*` are visible in frontend build output and are not server-side secrets.
- WebRTC connection success still depends on browser, network, NAT, firewall, TURN reachability, and media permission.
- Chat contents and drafts are memory-only by design; refresh or close clears them.
- Invite URLs are bearer capabilities and do not independently verify the other participant's identity.
- Non-image files are capped at 2GiB, but unsupported browsers still cap the memory-backed download fallback at 10MiB.
- Browser UI validation may stop at a permission-denied screen unless fake media devices or explicit user permission are available.

## Documentation Maintenance

When behavior changes, update the most specific maintenance doc:

- Build/deploy or hosting: `docs/maintenance/deployment.md`
- Environment variables or secrets: `docs/maintenance/environment.md`
- PeerJS/WebRTC/TURN/fallback: `docs/maintenance/webrtc.md`
- Tests or verification workflow: `docs/maintenance/testing.md`
- Git, branch, commit, push workflow: `docs/maintenance/git.md`
- Product structure, routes, major modules, risks: this file

Then update `.codex/PROJECT_CONTEXT.md` if its concise summary becomes stale.
