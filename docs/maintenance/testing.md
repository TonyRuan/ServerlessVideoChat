# Testing And Verification

Required checks before claiming a code change is ready:

```powershell
npm test
npm run check
npm run lint
npm run build
```

For Android-affecting changes, also follow `docs/maintenance/android.md`: sync the Capacitor project, build `assembleDebug`, install it on an adb target, verify pairing and restart persistence from fresh UI hierarchy dumps, and inspect the crash buffer.

`npm run build` runs `scripts/bumpPatchVersionIfChanged.mjs` first. If source changes are present and the package version still matches `HEAD`, this may bump the patch version in `package.json` and `package-lock.json`.

## Focused Tests

Useful targeted commands:

```powershell
npm test -- src/lib/iceConfig.test.ts
npm test -- src/lib/turnCredentials.test.ts
npm test -- functions/api/turn-credentials.test.ts
npm test -- src/lib/connectionRecovery.test.ts
npm test -- src/lib/peerErrorPolicy.test.ts
npm test -- src/lib/mediaErrorPolicy.test.ts
npm test -- src/lib/transportWatchdog.test.ts
npm test -- src/lib/turnFallback.test.ts
npm test -- src/lib/mediaStats.test.ts
npm test -- src/lib/networkDiagnostics.test.ts
npm test -- src/components/NetworkDiagnosticsPanel.test.tsx
npm test -- src/components/CallIssuePanel.test.tsx
npm test -- src/components/InviteLinkCard.test.tsx
npm test -- src/lib/callConnectionPolicy.test.ts
npm test -- src/lib/callSession.test.ts
npm test -- src/lib/fileTransferBinary.test.ts
npm test -- src/lib/fileTransferFlow.test.ts
npm test -- src/lib/realtimeProtocol.test.ts
npm test -- src/components/CallControls.test.tsx
npm test -- src/components/ChatPanel.test.tsx
npm test -- src/lib/devicePairing.test.ts
npm test -- src/lib/runtimeUrls.test.ts
```

## Test Style

Most tests are Vitest unit tests under `src/lib/*.test.ts` and component server-render tests under `src/components/*.test.tsx`.

For display-only component behavior, use:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
```

For protocol, session, file-transfer flow, TURN, recovery, and stats helpers, test pure functions directly. Protocol tests should cover malformed, oversized, non-finite, stale, and wrong-peer payloads in addition to happy paths. Credential tests must verify expiry units, no-store behavior, malformed URL rejection, bounded TTL, and failure fallback without printing generated credential values.

## Browser Validation Notes

The call page requests camera and microphone permission. Do not approve browser permission prompts unless the user explicitly authorizes it.

If browser validation reaches the `Permission denied` error page, the call UI did not mount because media permission was denied. For isolated UI changes, prefer component tests or a browser setup with fake media devices.

Common surfaces to validate when relevant:

- Waiting state invite link and QR code: host opens `/call`, PeerJS becomes ready, and `myId` exists.
- Compact diagnostics: collapsed panel shows only connection status; expanded panel distinguishes media, chat control, and file transports plus credential source/expiry.
- Recovery: use fake media devices and two isolated browser contexts; verify the guest is the only replacement initiator and stale watchdog timers do not close a newer connection.
- TURN: verify normal `on` mode separately from `turn=force`; an enabled TURN status is not proof of relay, so confirm the selected candidate type in stats.
- Bottom controls: fixed overlay should not cover waiting-state content on small screens.
- Hidden desktop/mobile control variants must be inert and excluded from the accessibility tree.
- Join flow must reject bare Peer IDs and accept a complete valid invite URL.

## Lightweight Doc-Only Check

For documentation-only edits, at minimum run:

```powershell
git diff --check
```

Run the full checks anyway if documentation changed commands, build assumptions, deployment steps, or behavior descriptions that should be verified against code.
