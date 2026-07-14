# ServerlessVideoChat Agent Guide

This is the repository entrypoint for AI coding agents. Keep it short and operational; detailed maintenance notes live under `docs/maintenance/`.

## First Read

Read these before changing code, running builds, or deploying:

- `docs/maintenance/project-overview.md`: product shape, routes, key modules, known risks.
- `docs/maintenance/environment.md`: local environment variables and secret-handling rules.
- `docs/maintenance/webrtc.md`: PeerJS, WebRTC, STUN/TURN, fallback, diagnostics.
- `docs/maintenance/testing.md`: required checks and focused test commands.
- `docs/maintenance/deployment.md`: Cloudflare Pages and GitHub Pages deployment.
- `docs/maintenance/git.md`: local git workflow and safe staging.

`.codex/PROJECT_CONTEXT.md` is a concise Codex context index. If project behavior changes, update the relevant `docs/maintenance/*` file first, then keep `.codex/PROJECT_CONTEXT.md` aligned.

## Project Snapshot

ServerlessVideoChat is a P2P video chat app built with React 18, TypeScript, Vite, PeerJS, WebRTC, Tailwind CSS, Zustand, and React Router. Cloudflare Pages serves the static SPA and an optional same-origin Function issues short-lived TURN credentials; media never passes through the Function.

Primary routes:

- `/`: create or join a meeting.
- `/call/:remotePeerId?`: call screen.
- Session state is stored in the URL hash, for example `#session=...&role=host`.

## Key Files

- `src/pages/Home.tsx`: create/join flow.
- `src/pages/CallPage.tsx`: main call orchestration, media/data connection handling, controls, diagnostics, invite card.
- `src/hooks/usePeer.ts`: PeerJS lifecycle and RTC config application.
- `src/hooks/useMediaStream.ts`: local camera/mic stream acquisition and quality switching.
- `src/lib/callSession.ts`: session hash parsing and invite link construction.
- `src/lib/iceConfig.ts`: STUN/TURN server configuration and TURN mode parsing.
- `src/lib/turnCredentials.ts`: dynamic TURN credential validation, refresh, and static fallback.
- `src/lib/connectionRecovery.ts`: reconnect timing, watchdog deadlines, and TURN escalation policy.
- `src/lib/turnFallback.ts`: direct-connection failure fallback decisions.
- `src/lib/mediaStats.ts`: WebRTC stats, codec, bitrate, and TURN usage extraction.
- `src/lib/networkDiagnostics.ts`: ICE candidate diagnostic probe.
- `src/components/NetworkDiagnosticsPanel.tsx`: compact/expanded connection diagnostics UI.
- `src/components/InviteLinkCard.tsx`: invite link, copy button, and QR code.
- `public/_redirects`: Cloudflare Pages SPA fallback.
- `functions/api/turn-credentials.ts`: same-origin short-lived coturn REST credential endpoint.
- `public/404.html`: GitHub Pages SPA fallback.

## Commands

Install and run locally:

```powershell
npm install
npm run dev
```

Default local URL:

```text
http://127.0.0.1:5173/
```

Before claiming a code change is ready, run:

```powershell
npm test
npm run check
npm run lint
npm run build
```

`npm run build` may bump the patch version through `scripts/bumpPatchVersionIfChanged.mjs`; include the `package.json` and `package-lock.json` version changes when that happens.

## Critical Behavior Notes

- TURN defaults to `on`; dynamic short-lived credentials are preferred and complete static `VITE_TURN_*` values are migration/local fallback. Details are in `docs/maintenance/webrtc.md`.
- Cloudflare Pages is the preferred deploy target and uses root-path hosting; GitHub Pages uses `/ServerlessVideoChat/`.
- `.env.local` is intentionally ignored. Variable names and loading patterns are documented in `docs/maintenance/environment.md`.

## Non-Negotiable Rules

- Use subagents reasonably when the work can be split into independent checks or bounded implementation slices.
- Never print, commit, or hardcode `.env.local` values, Cloudflare tokens, TURN credentials, or direct secret values.
- Do not stage `.env.local`, `dist`, `.wrangler`, `node_modules`, local logs, or screenshots.
- Preserve Cloudflare Pages root-path behavior and GitHub Pages subpath behavior when touching routing or Vite base logic.
- Keep WebRTC, chat crypto, PeerJS connection state, and UI display changes separated where practical.
- The call page needs camera/microphone permission; do not accept browser permission prompts unless the user explicitly authorizes it.
- For component-only UI behavior, prefer existing server-rendered Vitest tests before browser tests that need real media permission.
- When changing project behavior, update the matching `docs/maintenance/*` document and `.codex/PROJECT_CONTEXT.md` if its summary becomes stale.
