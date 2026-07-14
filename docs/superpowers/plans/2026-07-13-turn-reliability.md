# TURN Reliability And Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded WebRTC recovery, short-lived TURN credentials, per-channel diagnostics, and an operational path to TLS TURN without replacing PeerJS.

**Architecture:** Pure policy modules decide recovery timing and validate credential responses. `usePeer` owns credential refresh and future PeerJS RTC configuration, while `CallPage` coordinates guest-only replacement and observes media/control/bulk transports. A same-origin Pages Function signs coturn REST credentials.

**Tech Stack:** React 18, TypeScript, PeerJS/WebRTC, Vitest, Cloudflare Pages Functions, coturn.

**Status (2026-07-14):** Tasks 1-5 are implemented and `v0.0.8` is deployed. Unit, build, Pages runtime, responsive browser, direct WebRTC, disconnect/rejoin, and forced-relay checks pass. The credential Function route is live but currently returns `503`, so the client uses static TURN fallback. Task 6 remains intentionally blocked until DNS, certificate, firewall/security-group, and coordinated coturn shared-secret prerequisites are ready; production auth has not been changed.

## Global Constraints

- Keep TURN mode `on` by default and `force` relay-only.
- Keep the guest as the only outgoing connection initiator.
- Preserve file-transfer resume state across transient reconnects.
- Preserve Cloudflare root hosting and GitHub Pages `/ServerlessVideoChat/` hosting.
- Never print, commit, or expose static TURN credentials, shared secrets, cloud tokens, or private keys.
- Do not replace PeerJS or combine the three current peer connections in this change.
- Do not approve real camera or microphone permission prompts during verification.

---

### Task 1: Recovery Policy

**Files:**
- Create: `src/lib/connectionRecovery.ts`
- Create: `src/lib/connectionRecovery.test.ts`
- Modify: `src/lib/callConnectionPolicy.ts`
- Modify: `src/lib/callConnectionPolicy.test.ts`

**Interfaces:**
- Produces: `reconnectDelayMs(attempt, random?)`, `transportRecoveryDelayMs(state)`, and `nextRecoveryTurnMode(input)`.

- [x] Add failing tests for six retry delays, jitter bounds, 15-second connection timeout, 5-second disconnected grace, immediate failure, and `on` to `force` promotion.
- [x] Run `npm test -- src/lib/connectionRecovery.test.ts src/lib/callConnectionPolicy.test.ts` and verify failures are caused by missing behavior.
- [x] Implement the minimal pure policy and replace the three-attempt helper.
- [x] Re-run focused tests and `npm run check`.

### Task 2: Short-Lived Credential Client

**Files:**
- Create: `src/lib/turnCredentials.ts`
- Create: `src/lib/turnCredentials.test.ts`
- Modify: `src/lib/iceConfig.ts`
- Modify: `src/lib/iceConfig.test.ts`
- Modify: `src/hooks/usePeer.ts`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Produces: `loadTurnCredentials(options)`, validated `TurnCredentials`, static fallback resolution, expiry refresh, and `applyTurnMode(mode)` for future connections.

- [x] Add failing tests for valid responses, malformed URLs, missing fields, expiry safety margin, timeout/fetch failure, and static fallback.
- [x] Run focused tests and verify expected failures.
- [x] Implement endpoint loading with abort timeout and strict response validation.
- [x] Initialize PeerJS after the first credential resolution and refresh credentials before expiration without disturbing healthy connections.
- [x] Re-run focused tests and `npm run check`.

### Task 3: Pages Credential Function

**Files:**
- Create: `functions/api/turn-credentials.ts`
- Create: `functions/api/turn-credentials.test.ts`
- Create: `public/_routes.json`
- Modify: `docs/maintenance/deployment.md`
- Modify: `docs/maintenance/environment.md`

**Interfaces:**
- Consumes: `TURN_SHARED_SECRET`, `TURN_URLS`, optional `TURN_CREDENTIAL_TTL_SECONDS`.
- Produces: same-origin `GET /api/turn-credentials` JSON with `urls`, `username`, `credential`, and `expiresAt`.

- [x] Add failing tests for HMAC output shape, method rejection, missing configuration, no-store headers, and bounded TTL.
- [x] Run the focused function test and verify expected failures.
- [x] Implement HMAC-SHA1 signing with Web Crypto and no credential logging.
- [x] Restrict Pages Function routing to `/api/*` and document secret/variable configuration.
- [x] Run focused tests and `npm run check`.

### Task 4: Recovery Orchestration

**Files:**
- Modify: `src/hooks/usePeer.ts`
- Modify: `src/pages/CallPage.tsx`
- Modify: `src/lib/turnFallback.ts`
- Modify: `src/lib/turnFallback.test.ts`

**Interfaces:**
- Consumes: recovery policy and `applyTurnMode(mode)`.
- Produces: cancellable connection/disconnected watchdogs, six-attempt guest reconnect, passive host recovery, and relay-only final stage.

- [x] Add failing policy tests for host wait, guest retry, fallback status wording, and repeated `on` failure promotion.
- [x] Wire watchdogs to current-generation media and data peer connections; stale timers must not mutate current state.
- [x] Reset retry stages after stable connection and cancel all timers on hangup/unmount.
- [x] Verify file-transfer state remains retained on transient data replacement.
- [x] Run TURN, connection policy, file flow, and type-check tests.

### Task 5: Per-Channel Diagnostics And ICE Cleanup

**Files:**
- Modify: `src/lib/iceConfig.ts`
- Modify: `src/lib/iceConfig.test.ts`
- Modify: `src/lib/mediaStats.ts`
- Modify: `src/lib/mediaStats.test.ts`
- Modify: `src/components/NetworkDiagnosticsPanel.tsx`
- Modify: `src/components/NetworkDiagnosticsPanel.test.tsx`
- Modify: `src/pages/CallPage.tsx`

**Interfaces:**
- Produces: two base STUN servers and media/control/bulk transport snapshots with selected TURN usage.

- [x] Add failing tests for the reduced STUN set, per-channel labels, and wording that distinguishes enabled candidates from selected relay.
- [x] Export selected-pair TURN extraction for any peer connection.
- [x] Sample each active peer connection and pass snapshots to the expanded panel; collapsed markup remains unchanged.
- [x] Run focused diagnostics tests and `npm run check`.

### Task 6: Coturn And Production Migration

**Files:**
- Modify locally only: `.env.local` after production dynamic credentials are verified.
- Modify remotely only: backed-up coturn configuration and certificate renewal hook.
- Modify: `docs/maintenance/webrtc.md`
- Modify: `.codex/PROJECT_CONTEXT.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: DNS-only TURN hostname, Pages secret/variables, matching coturn shared secret, and cloud firewall access.
- Produces: UDP/TCP TURN plus TLS 443, expanded relay range, quotas, and no static credentials in the production frontend bundle.

- [ ] Confirm DNS and Alibaba security group readiness; do not alter live auth until both are ready.
- [ ] Back up coturn configuration, provision certificate, configure TLS 443, REST secret auth, relay range, and quotas.
- [ ] Configure Pages secret/variables without echoing values and deploy a migration build.
- [ ] Verify dynamic relay candidates and forced relay call before removing static frontend credentials.
- [ ] Test expired credentials, UDP, TLS 443, service restart, and rollback procedure.
- [ ] Update operational documentation without recording secret values.

### Task 7: Full Verification

**Files:**
- Modify only as required by verified defects: implementation and matching test files.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: tested local build and a deployment-ready migration.

- [x] Run `npm test`, `npm run check`, `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Start Vite with fake media devices and exercise host/guest in isolated browser contexts.
- [ ] Verify default direct selection, `turn=force`, media reconnect, data reconnect, file resume, and diagnostics at desktop/mobile widths.
- [x] Review diffs and build output for embedded long-lived credentials or unrelated files. Do not commit or push unless explicitly requested.
