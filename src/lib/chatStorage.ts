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
const PERSISTENT_CONVERSATION_PREFIX = 'device:';

export function makeConversationId(
  peerA: string,
  peerB: string,
  callSessionId?: string,
  persistent = false
) {
  if (callSessionId?.trim()) return `${persistent ? PERSISTENT_CONVERSATION_PREFIX : 'session:'}${callSessionId}`;
  return [peerA, peerB].sort().join(':');
}

export function isPersistentConversationId(conversationId: string) {
  return conversationId.startsWith(PERSISTENT_CONVERSATION_PREFIX);
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

const getStorageKey = (prefix: string, conversationId: string) =>
  `${prefix}:${encodeURIComponent(conversationId)}`;

const isStoredChatMessage = (value: unknown): value is ChatMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128 &&
    typeof record.conversationId === 'string' && isPersistentConversationId(record.conversationId) &&
    (record.direction === 'in' || record.direction === 'out') &&
    (record.kind === 'text' || record.kind === 'image' || record.kind === 'file' || record.kind === 'mixed') &&
    typeof record.createdAt === 'number' && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0 &&
    (record.status === 'sending' || record.status === 'sent' || record.status === 'received' || record.status === 'failed')
  );
};

const prepareMessageForStorage = (message: ChatMessage): ChatMessage => {
  const file = message.file
    ? {
        mimeType: message.file.mimeType,
        name: message.file.name,
        size: message.file.size,
      }
    : undefined;
  const activeFileTransfer = message.fileTransfer && ['waiting', 'offered', 'transferring', 'ready'].includes(message.fileTransfer.status);

  return {
    ...message,
    ...(file ? { file } : { file: undefined }),
    ...(message.fileTransfer
      ? {
          fileTransfer: activeFileTransfer
            ? {
                ...message.fileTransfer,
                status: 'failed',
                error: '应用已重启，请重新发送文件',
                bytesPerSecond: undefined,
              }
            : { ...message.fileTransfer, bytesPerSecond: undefined },
        }
      : {}),
  };
};

export function loadChatMessages(conversationId: string): ChatMessage[] {
  if (!isPersistentConversationId(conversationId) || typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(getStorageKey(CHAT_STORAGE_PREFIX, conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: unknown; messages?: unknown };
    if (parsed.version !== CHAT_STORAGE_VERSION || !Array.isArray(parsed.messages)) return [];
    return trimMessagesForStorage(parsed.messages.filter(isStoredChatMessage));
  } catch {
    return [];
  }
}

export function saveChatMessages(conversationId: string, messages: ChatMessage[]) {
  if (!isPersistentConversationId(conversationId) || typeof localStorage === 'undefined') return;
  try {
    const prepared = trimMessagesForStorage(messages.map(prepareMessageForStorage));
    localStorage.setItem(
      getStorageKey(CHAT_STORAGE_PREFIX, conversationId),
      JSON.stringify({ version: CHAT_STORAGE_VERSION, messages: prepared })
    );
  } catch {
    // Persistence is best-effort when the browser quota or privacy mode blocks writes.
  }
}

export function loadChatDraft(conversationId: string) {
  if (!isPersistentConversationId(conversationId) || typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(getStorageKey(DRAFT_STORAGE_PREFIX, conversationId)) ?? '';
  } catch {
    return '';
  }
}

export function saveChatDraft(conversationId: string, draftText: string) {
  if (!isPersistentConversationId(conversationId) || typeof localStorage === 'undefined') return;
  try {
    const key = getStorageKey(DRAFT_STORAGE_PREFIX, conversationId);
    if (draftText) {
      localStorage.setItem(key, draftText);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Persistence is best-effort when the browser quota or privacy mode blocks writes.
  }
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
