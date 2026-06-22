import {
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_DATA_URL_CHARS,
  type ChatImageAttachment,
  type ChatKind,
  type ChatMessage,
} from './chatStorage';

export interface WireChatMessage {
  id: string;
  from: string;
  kind: ChatKind;
  text?: string;
  image?: ChatImageAttachment;
  createdAt: number;
}

export interface WireChatPayload {
  type: 'CHAT_MESSAGE';
  message: WireChatMessage;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function createWireChatMessage(message: ChatMessage, from: string): WireChatPayload {
  return {
    type: 'CHAT_MESSAGE',
    message: {
      id: message.id,
      from,
      kind: message.kind,
      text: message.text,
      image: message.image,
      createdAt: message.createdAt,
    },
  };
}

function isChatImageAttachment(image: unknown): image is ChatImageAttachment {
  if (typeof image !== 'object' || image === null) return false;

  const record = image as Record<string, unknown>;
  return (
    typeof record.dataUrl === 'string' &&
    typeof record.mimeType === 'string' &&
    ALLOWED_IMAGE_TYPES.has(record.mimeType) &&
    record.dataUrl.startsWith(`data:${record.mimeType};base64,`) &&
    record.dataUrl.length <= MAX_CHAT_IMAGE_DATA_URL_CHARS &&
    typeof record.name === 'string' &&
    typeof record.size === 'number' &&
    record.size > 0 &&
    record.size <= MAX_CHAT_IMAGE_BYTES
  );
}

export function isWireChatPayload(payload: unknown): payload is WireChatPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  if (record.type !== 'CHAT_MESSAGE') return false;
  if (typeof record.message !== 'object' || record.message === null) return false;

  const message = record.message as Record<string, unknown>;
  if (typeof message.id !== 'string') return false;
  if (typeof message.from !== 'string') return false;
  if (typeof message.createdAt !== 'number') return false;
  if (message.kind !== 'text' && message.kind !== 'image' && message.kind !== 'mixed') return false;

  const hasText = typeof message.text === 'string' && message.text.trim().length > 0;
  const hasImage = isChatImageAttachment(message.image);

  if (message.kind === 'text') return hasText && !message.image;
  if (message.kind === 'image') return hasImage && !hasText;
  return hasText && hasImage;
}

export function wireMessageToIncomingChatMessage(
  payload: WireChatPayload,
  conversationId: string
): ChatMessage {
  return {
    id: payload.message.id,
    conversationId,
    direction: 'in',
    kind: payload.message.kind,
    text: payload.message.text,
    image: payload.message.image,
    createdAt: payload.message.createdAt,
    status: 'received',
  };
}
