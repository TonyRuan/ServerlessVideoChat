# Session Media Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate the host's initial camera and microphone choices to guests without requesting disabled devices, while preserving later manual enablement.

**Architecture:** Store media defaults in the URL session contract, derive selective `getUserMedia` constraints from those defaults, and reserve disabled PeerJS senders with hardware-free placeholder tracks. The call page initializes from the URL and existing controls replace placeholders with real tracks on demand.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, PeerJS, WebRTC MediaStream APIs

## Global Constraints

- Existing invite hashes without `audio` or `video` parameters default both media kinds to enabled.
- Disabled media kinds must not be passed to `getUserMedia`.
- Media defaults are preferences, not permanent locks.
- Do not use localStorage for session state.
- Do not expose or modify secret values.

---

### Task 1: Session URL Contract

**Files:**
- Modify: `src/lib/callSession.ts`
- Test: `src/lib/callSession.test.ts`

**Interfaces:**
- Produces: `CallMediaDefaults`, `DEFAULT_CALL_MEDIA_DEFAULTS`, and media defaults on `CallSessionState` and `ParsedInviteInput`.
- Produces: `buildInviteLink(baseUrl, hostPeerId, sessionId, mediaDefaults?)`.

- [x] Write failing tests proving `audio=0` and `video=0` round-trip through hashes, copied invites, pasted invites, and `resolveCallSessionState`.
- [x] Run `npm test -- src/lib/callSession.test.ts` and confirm the new assertions fail.
- [x] Add strict parsing where only the exact value `0` disables a media kind, and omit enabled values when serializing.
- [x] Run `npm test -- src/lib/callSession.test.ts` and confirm it passes.

### Task 2: Selective Media Acquisition

**Files:**
- Create: `src/lib/mediaDevicePolicy.ts`
- Create: `src/lib/mediaDevicePolicy.test.ts`
- Modify: `src/hooks/useMediaStream.ts`

**Interfaces:**
- Produces: `buildMediaStreamConstraints(quality, defaults)` and placeholder-track factories.
- Changes: `initializeStream(quality?, defaults?)` initializes only requested hardware.
- Changes: `toggleAudio()` and `toggleVideo()` become asynchronous and replace placeholder tracks with requested hardware tracks.

- [x] Write failing tests for full, audio-only, video-only, and device-free constraints.
- [x] Run `npm test -- src/lib/mediaDevicePolicy.test.ts` and confirm the module is missing.
- [x] Implement selective constraints and silent/black placeholder track creation with explicit cleanup ownership.
- [x] Update the hook so failed on-demand acquisition keeps the previous disabled state and placeholder.
- [x] Run the focused tests and `npm run check`.

### Task 3: Creation and Call Initialization

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/CallPage.tsx`
- Test: `src/lib/callSession.test.ts`

**Interfaces:**
- Consumes: session media defaults and `initializeStream(quality?, defaults?)`.
- Produces: host, guest, copied, and QR invite URLs with the same initial media defaults.

- [x] Build the host hash from `isAudioEnabled` and `isVideoEnabled` at meeting creation.
- [x] Preserve parsed defaults when joining a pasted invite.
- [x] Initialize CallPage media with the parsed defaults and pass those defaults to `buildInviteLink`.
- [x] Await asynchronous media toggles so on-demand acquisition errors remain coherent.
- [x] Run the focused call-session tests and `npm run check`.

### Task 4: Documentation and Verification

**Files:**
- Modify: `docs/maintenance/project-overview.md`
- Modify: `docs/maintenance/webrtc.md`
- Modify: `.codex/PROJECT_CONTEXT.md`

**Interfaces:**
- Documents: URL parameters, device permission timing, placeholder sender behavior, and test commands.

- [x] Update maintenance documentation and the concise project context index.
- [x] Run `npm test`.
- [x] Run `npm run check` and `npm run lint`.
- [x] Run `npm run build` and account for the expected patch version bump.
- [ ] Smoke-test host creation plus voice-only and text-only direct invite routes in a real browser without accepting device permission prompts.
