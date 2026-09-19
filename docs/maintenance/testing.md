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
npm test -- src/lib/fileTransferBackpressure.test.ts
npm test -- src/lib/fileTransferTransport.test.ts
npm test -- src/lib/fileTransferProgress.test.ts src/stores/chatStore.test.ts
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

`fileTransferTransport.test.ts` exercises both file modes with real Web Crypto sessions, byte-for-byte transfers spanning multiple credit windows and a partial final chunk, early ACKs during send/drain, resume offsets, replayed acceptance at zero bytes, and coalesced credit publication. Progress/store tests cover time-based UI throttling, retained transfer mode, progress updates without history writes, and persisted completion. These tests establish protocol correctness; they do not measure real-network throughput or replace browser/Android QA.

`fileTransferBackpressure.test.ts` covers high/low-water pacing, immediate event wakeup, a drain during listener setup, missed-event polling, close/error handling, cancellation, concurrent waits, and listener/timer cleanup. The pump/backpressure integration cases in `fileTransferTransport.test.ts` cancel a generation while its first chunk waits for browser drain, verify that no later chunk or progress update escapes, and resume from receiver-confirmed persisted offsets. They separately verify replay of an unpersisted first chunk and skipping a confirmed first chunk; a queued browser send alone is not proof that the receiver saved it.

## Browser Validation Notes

For measured file-transfer results, benchmark scope, and excluded samples, see [file-transfer-performance.md](file-transfer-performance.md).

The call page requests camera and microphone permission. Do not approve browser permission prompts unless the user explicitly authorizes it.

If browser validation reaches the `Permission denied` error page, the call UI did not mount because media permission was denied. For isolated UI changes, prefer component tests or a browser setup with fake media devices.

Common surfaces to validate when relevant:

- Waiting state invite link and QR code: host opens `/call`, PeerJS becomes ready, and `myId` exists.
- Compact diagnostics: collapsed panel shows only connection status; expanded panel distinguishes media, chat control, and file transports plus credential source/expiry.
- Recovery: use fake media devices and two isolated browser contexts; verify the guest is the only replacement initiator and stale watchdog timers do not close a newer connection.
- File modes: confirm encrypted is the default, fast requires peer capability support and matching acceptance, text/images stay encrypted, and transfer cards identify the selected mode. An old client must still support default encrypted transfers and require an update for fast mode.
- File recovery/performance: compare the same file in both modes over a verified direct path and separately over TURN, check received bytes, and interrupt/reconnect a multi-window transfer. Verify progress does not reset or stall and record measured throughput before claiming a speed gain. Validate direct disk saving and the browser memory fallback separately; an Android release also requires the Android checks above.
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
