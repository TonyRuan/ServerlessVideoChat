# ServerlessVideoChat Codex Context

> Keep this file concise. Update the relevant `docs/maintenance/*` document first, then keep this summary aligned.
> Last synced: 2026-07-13.

## What This Project Is

`ServerlessVideoChat` is a frontend-only static SPA for P2P video chat. PeerJS handles signaling. Browser WebRTC carries audio, video, encrypted chat payloads, heart reactions, quality changes, diagnostics, and reconnect/session metadata.

Primary stack:

- React 18 + TypeScript + Vite
- React Router DOM v7
- PeerJS + WebRTC
- Zustand
- Tailwind CSS

## Current Behavior To Remember

- Main routes are `/` and `/call/:remotePeerId?`.
- Meeting recovery state lives in the URL hash, for example `#session=...&role=host`.
- The home join form accepts only a complete valid HTTP/HTTPS invite URL; bare Peer IDs are rejected.
- Chat messages and drafts are memory-only by design; refresh or close clears them. Accepted files may be saved directly to disk when the receiver's browser supports it.
- Default TURN mode is `on` when configured, so initial RTC config includes STUN plus TURN candidates.
- URL query/hash and `VITE_TURN_MODE` can still disable TURN or force relay-only diagnostics.
- If TURN is explicitly off and direct transport fails, the app can enable TURN fallback and retry without changing the local Peer ID; fallback retry/wait roles are based on stable session role.
- Only the guest initiates media/control/bulk connections. The host accepts incoming connections only when session, role, channel, and actual PeerJS peer identity match; active connections cannot be replaced by an unsolicited duplicate.
- The left-top diagnostics panel is compact by default and expands to full debug details.
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

## Key Files

- `src/pages/CallPage.tsx`: main call UI and orchestration.
- `src/hooks/usePeer.ts`: PeerJS lifecycle and RTC config.
- `src/hooks/useMediaStream.ts`: local media acquisition and quality switching.
- `src/hooks/useAutoHideControls.ts`: call-control auto-hide behavior.
- `src/lib/iceConfig.ts`: STUN/TURN config and TURN mode parsing.
- `src/lib/turnFallback.ts`: direct failure fallback decisions.
- `src/lib/callSession.ts`: URL session parsing and invite links.
- `src/lib/callConnectionPolicy.ts`: call role, metadata, replacement, and peer-binding policy.
- `src/lib/fileTransferBinary.ts`: binary file frames.
- `src/lib/fileTransferFlow.ts`: credit, ACK, and resume calculations.
- `src/lib/realtimeProtocol.ts`: strict realtime payload validation.
- `src/lib/mediaStats.ts`: codec, bitrate, bandwidth, TURN usage stats.
- `src/components/NetworkDiagnosticsPanel.tsx`: compact/expanded debug panel.
- `src/components/InviteLinkCard.tsx`: share link and QR code.
- `src/components/ChatPanel.tsx`: encrypted chat UI, image preview attachments, and file download cards.
- `src/components/CallControls.tsx`: accessible desktop/mobile call controls.

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
- TURN `VITE_*` values become frontend-visible build data.
- WebRTC behavior depends on real browser/network/media permission state.
- Cloudflare Pages uses root-path hosting; GitHub Pages uses `/ServerlessVideoChat/`.
- Do not approve camera/microphone browser prompts unless the user explicitly authorizes it.
