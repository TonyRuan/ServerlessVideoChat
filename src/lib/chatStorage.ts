export const CHAT_STORAGE_VERSION = 1;
export const MAX_CHAT_MESSAGES = 200;
export const MAX_CHAT_STORAGE_CHARS = 1_000_000;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4 + 128;
export const MAX_CHAT_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_NAME_CHARS = 255;

export type ChatDirection = 'in' | 'out';
export type ChatKind = 'text' | 'image' | 'file' | 'mixed';
export type ChatStatus = 'sending' | 'sent' | 'received' | 'failed';
export type ChatFileTransferStatus =
  | 'waiting'
  | 'offered'
  | 'transferring'
  | 'ready'
  | 'saved'
  | 'sent'
  | 'rejected'
  | 'failed';

export interface ChatImageAttachment {
  dataUrl: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ChatFileAttachment {
  dataUrl?: string;
  objectUrl?: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ChatFileTransfer {
  id: string;
  status: ChatFileTransferStatus;
  bytesTransferred: number;
  startedAt?: number;
  updatedAt?: number;
  bytesPerSecond?: number;
  error?: string;
  saveMode?: 'file-system' | 'memory';
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  direction: ChatDirection;
  kind: ChatKind;
  text?: string;
  image?: ChatImageAttachment;
  file?: ChatFileAttachment;
  fileTransfer?: ChatFileTransfer;
  createdAt: number;
  status: ChatStatus;
}

const CHAT_STORAGE_PREFIX = 'serverlessVideoChat:chat:v1';
const DRAFT_STORAGE_PREFIX = 'serverlessVideoChat:chatDraft:v1';

export function makeConversationId(peerA: string, peerB: string, callSessionId?: string) {
  if (callSessionId?.trim()) return `session:${callSessionId}`;
  return [peerA, peerB].sort().join(':');
}

export function trimMessagesForStorage(messages: ChatMessage[]) {
  let trimmed = messages.slice(-MAX_CHAT_MESSAGES);

  while (
    trimmed.length > 0 &&
    JSON.stringify({ version: CHAT_STORAGE_VERSION, messages: trimmed }).length > MAX_CHAT_STORAGE_CHARS
  ) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

export function loadChatMessages(_conversationId: string): ChatMessage[] {
  void _conversationId;
  return [];
}

export function saveChatMessages(_conversationId: string, _messages: ChatMessage[]) {
  void _conversationId;
  void _messages;
  // Chat content is intentionally memory-only for privacy.
}

export function loadChatDraft(_conversationId: string) {
  void _conversationId;
  return '';
}

export function saveChatDraft(_conversationId: string, _draftText: string) {
  void _conversationId;
  void _draftText;
  // Drafts are intentionally memory-only for privacy.
}

export function purgePersistedChatStorage() {
  if (typeof localStorage === 'undefined') return;

  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (key.startsWith(`${CHAT_STORAGE_PREFIX}:`) || key.startsWith(`${DRAFT_STORAGE_PREFIX}:`)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Legacy cleanup is best-effort.
  }
}
