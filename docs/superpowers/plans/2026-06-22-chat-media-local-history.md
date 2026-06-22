# Chat Media Local History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add encrypted text-and-image chat to the video call page, with browser-local chat history.

**Architecture:** Keep video layout stable and add chat as an overlay panel. Add pure chat crypto/storage modules with tests, a Zustand chat store for UI state and persistence, and connect chat messages to the existing PeerJS DataConnection without changing existing `HEART` or `QUALITY_CHANGE` payloads.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, PeerJS DataConnection, Web Crypto ECDH + AES-GCM, localStorage, Vitest.

---

### Task 1: Test Harness And Pure Chat Logic

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/chatStorage.test.ts`
- Create: `src/lib/chatCrypto.test.ts`
- Create: `src/lib/chatStorage.ts`
- Create: `src/lib/chatCrypto.ts`

- [x] Add Vitest and a `test` script.
- [x] Write RED tests for `makeConversationId`, message trimming, and encrypted round-trip.
- [x] Run `npm test -- --run` and confirm tests fail because modules do not exist.
- [x] Implement `chatStorage.ts` and `chatCrypto.ts`.
- [x] Run `npm test -- --run` and confirm tests pass.

### Task 2: Chat Store And UI

**Files:**
- Create: `src/stores/chatStore.ts`
- Create: `src/components/ChatPanel.tsx`
- Modify: `src/pages/CallPage.tsx`

- [x] Add `chatStore` with conversation loading, localStorage persistence, unread tracking, draft text, message upsert, and status updates.
- [x] Add `ChatPanel` with message list, text input, single-image picker, image preview, clear connection/secure state, and send button.
- [x] Add a `MessageCircle` button with unread badge to the call controls.
- [x] Render desktop right overlay and mobile bottom sheet without restructuring video layout.

### Task 3: DataConnection Integration And Encryption

**Files:**
- Modify: `src/pages/CallPage.tsx`
- Modify: `src/stores/chatStore.ts`

- [x] Track `isDataConnected`, `isChatSecure`, and `conversationPeerId`.
- [x] Add ECDH public-key handshake messages: `{ type: 'CHAT_CRYPTO_KEY', version: 1, publicKey }`.
- [x] Add encrypted chat payload messages: `{ type: 'CHAT_CIPHER', version: 1, iv, data }`.
- [x] Convert local chat messages to wire messages, encrypt them with AES-GCM, send over DataConnection, and update send status.
- [x] Decrypt incoming chat payloads, validate shape, and store as received messages.
- [x] Preserve existing handling for `HEART` and `QUALITY_CHANGE`.

### Task 4: Docs And Verification

**Files:**
- Modify: `.codex/PROJECT_CONTEXT.md`

- [x] Document chat protocol, localStorage behavior, image size limits, and transport encryption.
- [x] Run `npm test -- --run`.
- [x] Run `npm run check`.
- [x] Run `npm run build`.
- [x] Run `npm run lint` and report any existing or new failures.
