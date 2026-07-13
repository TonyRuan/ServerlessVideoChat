# Connection And Transfer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make calls deterministic across reconnects and make encrypted file transfer bounded, resumable, and suitable for large files.

**Architecture:** A role-owned PeerJS connection epoch controls media, control data, and bulk data lifecycles. Pure policy/protocol modules validate identity and implement receiver credit, while `CallPage` coordinates those modules and UI state.

**Tech Stack:** React 18, TypeScript, PeerJS/WebRTC, Web Crypto, Zustand, Vitest, Vite.

## Global Constraints

- Preserve frontend-only hosting, Cloudflare root base, and GitHub Pages `/ServerlessVideoChat/` base.
- Do not expose or commit `.env.local`, Cloudflare tokens, or TURN credentials.
- Keep file fallback memory capped at 10 MiB and accepted file size capped at 2 GiB.
- Keep raw file chunks at 256 KiB.
- Do not persist chat or file data to localStorage.
- Do not approve real camera or microphone prompts during browser validation.

---

### Task 1: Media Request Generations

**Files:**
- Create: `src/lib/mediaStreamLifecycle.ts`
- Create: `src/lib/mediaStreamLifecycle.test.ts`
- Modify: `src/hooks/useMediaStream.ts`

**Interfaces:**
- Produces: `createMediaStreamLifecycle()` with `begin()`, `isCurrent(token)`, `commit(token, stream)`, and `invalidate()`.

- [ ] Write tests proving a newer request supersedes an older request, invalidated streams are stopped, and the previous committed stream is stopped only after replacement.
- [ ] Run `npm test -- src/lib/mediaStreamLifecycle.test.ts`; expect failure because the lifecycle helper does not exist.
- [ ] Implement the helper and use it around `getUserMedia` without stopping the current stream before success.
- [ ] Run the focused test and `npm run check`; expect both to pass.

### Task 2: Role And Identity Connection Policy

**Files:**
- Modify: `src/lib/callConnectionPolicy.ts`
- Modify: `src/lib/callConnectionPolicy.test.ts`
- Modify: `src/hooks/usePeer.ts`
- Modify: `src/pages/CallPage.tsx`

**Interfaces:**
- Produces: `shouldInitiateConnection(role)`, `validateIncomingConnection(metadata, context)`, and role-aware reconnect decisions.

- [ ] Add failing policy tests for guest-only dialing, host-only acceptance, opposite-role metadata, metadata/transport peer equality, and duplicate peer rejection.
- [ ] Run `npm test -- src/lib/callConnectionPolicy.test.ts`; expect the new assertions to fail.
- [ ] Implement pure policy functions and apply them to incoming media/data handlers and outgoing effects.
- [ ] Add a reconnect-disabled ref for hang-up/unmount and trigger guest media retry after close/error with bounded backoff.
- [ ] Validate `SESSION_RESUME.peerId` and every decrypted `from` against the DataConnection peer.
- [ ] Run the focused tests and `npm run check`; expect both to pass.

### Task 3: Binary File Frames And Receiver Credit

**Files:**
- Create: `src/lib/fileTransferBinary.ts`
- Create: `src/lib/fileTransferBinary.test.ts`
- Create: `src/lib/fileTransferFlow.ts`
- Create: `src/lib/fileTransferFlow.test.ts`
- Modify: `src/lib/chatCrypto.ts`
- Modify: `src/lib/chatCrypto.test.ts`
- Modify: `src/lib/chatProtocol.ts`
- Modify: `src/lib/chatProtocol.test.ts`
- Modify: `src/lib/dataConnectionPayload.ts`
- Modify: `src/hooks/usePeer.ts`
- Modify: `src/pages/CallPage.tsx`

**Interfaces:**
- Produces: `encodeFileChunkFrame`, `decodeFileChunkFrame`, binary AES-GCM envelopes, `applyFileTransferCredit`, and credit/completion/error control payloads.

- [ ] Add failing frame tests for lossless 256 KiB bytes, malformed headers, oversized chunks, and invalid offsets.
- [ ] Add failing flow tests proving the sender cannot pass `creditEnd`, acknowledgement never moves backward, and resume resets the next offset to receiver-persisted bytes.
- [ ] Add failing crypto tests proving binary plaintext round trips without base64.
- [ ] Run the three focused test files; expect failures for missing interfaces.
- [ ] Implement binary framing, binary AES-GCM envelopes, and strict control payload validators.
- [ ] Add `control` and `bulk` connection metadata/labels; only the guest opens them and only the host accepts them.
- [ ] Replace base64 chunk sending with encrypted binary bulk messages.
- [ ] Grant bounded credit after acceptance, replenish it after writes, send final completion after close, and keep transfer state across transient reconnects.
- [ ] Run focused tests, `npm run check`, and the existing file-transfer/store tests; expect all to pass.

### Task 4: Protocol, Memory, Join, And Build Boundaries

**Files:**
- Modify: `src/lib/chatProtocol.ts`
- Modify: `src/lib/chatProtocol.test.ts`
- Modify: `src/stores/chatStore.ts`
- Modify: `src/stores/chatStore.test.ts`
- Modify: `src/pages/Home.tsx`
- Modify: `src/lib/callSession.ts`
- Modify: `src/lib/callSession.test.ts`
- Modify: `src/App.tsx`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: finite-number validators, bounded chat eviction with URL cleanup, and `parseInviteInput(input)` that accepts only session-bound invite URLs.

- [ ] Add failing tests for `NaN`/`Infinity`, malformed quality/heart messages, message eviction, URL revocation, and rejection of bare PeerJS IDs.
- [ ] Run focused tests; expect failures that demonstrate the current permissive behavior.
- [ ] Implement validators, a 200-message in-memory cap, and object URL revocation on eviction/reset.
- [ ] Replace permissive home parsing with tested complete-invite parsing and display an inline validation error.
- [ ] Lazy-load `CallPage`, disable production locator/source maps, and update Vite within 6.4.x.
- [ ] Run focused tests, `npm audit`, and `npm run check`; expect no new applicable production finding.

### Task 5: Accessible Call Controls And Component Extraction

**Files:**
- Create: `src/components/CallControls.tsx`
- Create: `src/components/CallControls.test.tsx`
- Create: `src/hooks/useAutoHideControls.ts`
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/CallPage.tsx`

**Interfaces:**
- Produces: `CallControls` for desktop/mobile controls and `useAutoHideControls({ locked })` for visibility timing.

- [ ] Add failing server-render tests for button labels, pressed state, hidden navigation state, and dialog semantics.
- [ ] Run component tests; expect missing labels/attributes to fail.
- [ ] Extract controls and auto-hide behavior, apply `aria-label`, `aria-pressed`, `aria-hidden`, and `inert`.
- [ ] Add Escape close, initial focus, and focus restoration for chat/mobile panels.
- [ ] Run component tests and `npm run check`; expect both to pass.

### Task 6: Documentation And End-To-End Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/maintenance/project-overview.md`
- Modify: `docs/maintenance/testing.md`
- Modify: `docs/maintenance/webrtc.md`
- Modify: `.codex/PROJECT_CONTEXT.md`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: current operational guidance for future maintainers and agents.

- [ ] Update behavior, protocol, reconnect, compatibility, test, and known-risk documentation.
- [ ] Run `npm test`, `npm run check`, `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Start a local Vite server on a free port and verify home validation plus desktop/mobile call controls with fake media devices.
- [ ] Review the final diff for secrets, generated files, accidental output staging, and unrelated changes. Do not commit unless the user asks.
