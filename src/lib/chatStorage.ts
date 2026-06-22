export const CHAT_STORAGE_VERSION = 1;
export const MAX_CHAT_MESSAGES = 200;
export const MAX_CHAT_STORAGE_CHARS = 1_000_000;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4 + 128;

export type ChatDirection = 'in' | 'out';
export type ChatKind = 'text' | 'image' | 'mixed';
export type ChatStatus = 'sending' | 'sent' | 'received' | 'failed';

export interface ChatImageAttachment {
  dataUrl: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  direction: ChatDirection;
  kind: ChatKind;
  text?: string;
  image?: ChatImageAttachment;
  createdAt: number;
  status: ChatStatus;
}

interface PersistedChatHistory {
  version: typeof CHAT_STORAGE_VERSION;
  conversationId: string;
  updatedAt: number;
  messages: ChatMessage[];
}

const CHAT_STORAGE_PREFIX = 'serverlessVideoChat:chat:v1';
const DRAFT_STORAGE_PREFIX = 'serverlessVideoChat:chatDraft:v1';

const getHistoryKey = (conversationId: string) => `${CHAT_STORAGE_PREFIX}:${conversationId}`;
const getDraftKey = (conversationId: string) => `${DRAFT_STORAGE_PREFIX}:${conversationId}`;

export function makeConversationId(peerA: string, peerB: string) {
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

function stripOversizedImageDataForStorage(message: ChatMessage): ChatMessage {
  if (!message.image?.dataUrl) return message;

  const singleMessageLength = JSON.stringify({ version: CHAT_STORAGE_VERSION, messages: [message] }).length;
  if (singleMessageLength <= MAX_CHAT_STORAGE_CHARS) return message;

  return {
    ...message,
    image: {
      ...message.image,
      dataUrl: '',
    },
  };
}

export function loadChatMessages(conversationId: string): ChatMessage[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(getHistoryKey(conversationId));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Partial<PersistedChatHistory>;
    if (parsed.version !== CHAT_STORAGE_VERSION || !Array.isArray(parsed.messages)) return [];

    return parsed.messages.filter((message): message is ChatMessage => {
      return (
        typeof message?.id === 'string' &&
        message.conversationId === conversationId &&
        (message.direction === 'in' || message.direction === 'out') &&
        typeof message.createdAt === 'number'
      );
    });
  } catch {
    return [];
  }
}

export function saveChatMessages(conversationId: string, messages: ChatMessage[]) {
  if (typeof localStorage === 'undefined') return;

  const storageMessages = messages.map(stripOversizedImageDataForStorage);
  const trimmed = trimMessagesForStorage(storageMessages);
  const payload: PersistedChatHistory = {
    version: CHAT_STORAGE_VERSION,
    conversationId,
    updatedAt: Date.now(),
    messages: trimmed,
  };

  try {
    localStorage.setItem(getHistoryKey(conversationId), JSON.stringify(payload));
  } catch {
    const textOnly = trimmed.map((message) => ({
      ...message,
      image: message.image ? { ...message.image, dataUrl: '' } : undefined,
    }));
    try {
      localStorage.setItem(
        getHistoryKey(conversationId),
        JSON.stringify({ ...payload, messages: trimMessagesForStorage(textOnly) })
      );
    } catch {
      // Browsers can reject storage in private mode or when quota is exhausted.
    }
  }
}

export function loadChatDraft(conversationId: string) {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(getDraftKey(conversationId)) ?? '';
  } catch {
    return '';
  }
}

export function saveChatDraft(conversationId: string, draftText: string) {
  if (typeof localStorage === 'undefined') return;

  try {
    if (draftText.trim()) {
      localStorage.setItem(getDraftKey(conversationId), draftText);
    } else {
      localStorage.removeItem(getDraftKey(conversationId));
    }
  } catch {
    // Draft persistence is best-effort.
  }
}
