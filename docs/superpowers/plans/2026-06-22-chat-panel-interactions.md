# Chat Panel Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clipboard image paste, click-to-preview images, and draggable chat panel positioning to the existing encrypted chat UI.

**Architecture:** Keep the encrypted chat transport unchanged. Add small pure helper modules for clipboard image extraction and panel position clamping/persistence, then wire those helpers into `ChatPanel` so UI behavior stays testable and bounded.

**Tech Stack:** React 18, TypeScript, Vite, localStorage, Pointer Events, Vitest.

---

### Task 1: Clipboard Image Helper

**Files:**
- Create: `src/lib/chatAttachments.test.ts`
- Create: `src/lib/chatAttachments.ts`
- Modify: `src/components/ChatPanel.tsx`

- [x] Add failing tests for selecting the first supported image file from clipboard items and ignoring unsupported clipboard content.
- [x] Implement accepted image MIME constants and `getImageFileFromClipboardItems`.
- [x] Reuse helper in `ChatPanel` for file picker and paste handling.

### Task 2: Draggable Panel Position Helper

**Files:**
- Create: `src/lib/chatPanelPosition.test.ts`
- Create: `src/lib/chatPanelPosition.ts`
- Modify: `src/components/ChatPanel.tsx`

- [x] Add failing tests for clamping panel position inside viewport and best-effort localStorage persistence.
- [x] Implement `clampChatPanelPosition`, `loadChatPanelPosition`, and `saveChatPanelPosition`.
- [x] Add desktop pointer dragging on the chat panel header and persist the final position.

### Task 3: Image Preview Overlay

**Files:**
- Modify: `src/components/ChatPanel.tsx`
- Modify: `.codex/PROJECT_CONTEXT.md`

- [x] Add click-to-preview for message images and selected pasted/uploaded image.
- [x] Add modal close via backdrop, close button, and Escape.
- [x] Document clipboard paste, click preview, and draggable position behavior.

### Task 4: Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-06-22-chat-panel-interactions.md`

- [x] Run `npm test -- --run`.
- [x] Run `npm run check`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
