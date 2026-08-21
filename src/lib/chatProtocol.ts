import {
  MAX_CHAT_ATTACHMENT_NAME_CHARS,
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_DATA_URL_CHARS,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type ChatKind,
  type ChatMessage,
} from './chatStorage';
import { isAcceptedChatImageType } from './chatAttachments';
import { isValidCallSessionId, isValidPeerId, type CallSessionRole } from './callSession';

const FILE_MIME_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
export const MAX_CHAT_TEXT_CHARS = 10_000;
export const CHAT_FILE_STREAM_CHUNK_BYTES = 256 * 1024;
export const CHAT_FILE_CREDIT_WINDOW_BYTES = 1024 * 1024;
const CHAT_FILE_STREAM_CHUNK_DATA_CHARS = Math.ceil(CHAT_FILE_STREAM_CHUNK_BYTES / 3) * 4;

export interface WireChatMessage {
  id: string;
  from: string;
  kind: ChatKind;
  text?: string;
  image?: ChatImageAttachment;
  file?: ChatFileAttachment;
  createdAt: number;
}

export interface WireChatPayload {
  type: 'CHAT_MESSAGE';
  message: WireChatMessage;
}

export interface WireChatAckPayload {
  type: 'CHAT_ACK';
  version: 1;
  messageId: string;
  from: string;
}

export type WireChatFileSaveMode = 'file-system' | 'memory';

export type WireChatFileMetadata = Omit<ChatFileAttachment, 'dataUrl' | 'objectUrl'>;

export interface WireChatFileOfferPayload {
  type: 'CHAT_FILE_OFFER';
  version: 1;
  transferId: string;
  from: string;
  message: {
    id: string;
    kind: 'file' | 'mixed';
    text?: string;
    createdAt: number;
    file: WireChatFileMetadata;
  };
}

export interface WireChatFileAcceptPayload {
  type: 'CHAT_FILE_ACCEPT';
  version: 2;
  transferId: string;
  from: string;
  saveMode: WireChatFileSaveMode;
  acknowledgedOffset: 0;
  creditBytes: number;
}

export interface WireChatFileDeclinePayload {
  type: 'CHAT_FILE_DECLINE';
  version: 1;
  transferId: string;
  from: string;
}

export interface WireChatFileCreditPayload {
  type: 'CHAT_FILE_CREDIT';
  version: 2;
  transferId: string;
  from: string;
  acknowledgedOffset: number;
  creditBytes: number;
  resume: boolean;
}

export interface WireChatFileCompletePayload {
  type: 'CHAT_FILE_COMPLETE';
  version: 2;
  transferId: string;
  from: string;
  bytesReceived: number;
}

export interface WireChatFileErrorPayload {
  type: 'CHAT_FILE_ERROR';
  version: 2;
  transferId: string;
  from: string;
  message: string;
}

export interface WireChatFileChunkPayload {
  type: 'CHAT_FILE_STREAM_CHUNK';
  version: 1;
  transferId: string;
  from: string;
  chunk: {
    index: number;
    offset: number;
    data: string;
  };
}

export interface SessionResumePayload {
  type: 'SESSION_RESUME';
  version: 1;
  sessionId: string;
  peerId: string;
  role: CallSessionRole;
}

export function createWireChatMessage(message: ChatMessage, from: string): WireChatPayload {
  if (message.file || message.kind === 'file') {
    throw new Error('File messages must use the file transfer offer protocol');
  }

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

export function createWireChatAck(messageId: string, from: string): WireChatAckPayload {
  return {
    type: 'CHAT_ACK',
    version: 1,
    messageId,
    from,
  };
}

export function createWireChatFileOffer(message: ChatMessage, from: string): WireChatFileOfferPayload {
  if (!message.file || message.image || (message.kind !== 'file' && message.kind !== 'mixed')) {
    throw new Error('Message is not a file transfer');
  }

  const kind: 'file' | 'mixed' = message.kind;
  return {
    type: 'CHAT_FILE_OFFER',
    version: 1,
    transferId: message.id,
    from,
    message: {
      id: message.id,
      kind,
      text: message.text,
      createdAt: message.createdAt,
      file: {
        mimeType: message.file?.mimeType ?? '',
        name: message.file?.name ?? '',
        size: message.file?.size ?? 0,
      },
    },
  };
}

export function createWireChatFileAccept(
  transferId: string,
  from: string,
  saveMode: WireChatFileSaveMode,
  creditBytes = CHAT_FILE_CREDIT_WINDOW_BYTES
): WireChatFileAcceptPayload {
  return {
    type: 'CHAT_FILE_ACCEPT',
    version: 2,
    transferId,
    from,
    saveMode,
    acknowledgedOffset: 0,
    creditBytes,
  };
}

export function createWireChatFileDecline(transferId: string, from: string): WireChatFileDeclinePayload {
  return {
    type: 'CHAT_FILE_DECLINE',
    version: 1,
    transferId,
    from,
  };
}

export function createWireChatFileCredit(
  transferId: string,
  from: string,
  acknowledgedOffset: number,
  creditBytes = CHAT_FILE_CREDIT_WINDOW_BYTES,
  resume = false
): WireChatFileCreditPayload {
  return {
    type: 'CHAT_FILE_CREDIT',
    version: 2,
    transferId,
    from,
    acknowledgedOffset,
    creditBytes,
    resume,
  };
}

export function createWireChatFileComplete(
  transferId: string,
  from: string,
  bytesReceived: number
): WireChatFileCompletePayload {
  return {
    type: 'CHAT_FILE_COMPLETE',
    version: 2,
    transferId,
    from,
    bytesReceived,
  };
}

export function createWireChatFileError(
  transferId: string,
  from: string,
  message: string
): WireChatFileErrorPayload {
  return {
    type: 'CHAT_FILE_ERROR',
    version: 2,
    transferId,
    from,
    message,
  };
}

export function createWireChatFileStreamChunk({
  transferId,
  from,
  index,
  offset,
  data,
}: {
  transferId: string;
  from: string;
  index: number;
  offset: number;
  data: string;
}): WireChatFileChunkPayload {
  return {
    type: 'CHAT_FILE_STREAM_CHUNK',
    version: 1,
    transferId,
    from,
    chunk: {
      index,
      offset,
      data,
    },
  };
}

export function createSessionResumeMessage({
  sessionId,
  peerId,
  role,
}: {
  sessionId: string;
  peerId: string;
  role: CallSessionRole;
}): SessionResumePayload {
  return {
    type: 'SESSION_RESUME',
    version: 1,
    sessionId,
    peerId,
    role,
  };
}

function isChatImageAttachment(image: unknown): image is ChatImageAttachment {
  if (typeof image !== 'object' || image === null) return false;

  const record = image as Record<string, unknown>;
  return (
    typeof record.dataUrl === 'string' &&
    typeof record.mimeType === 'string' &&
    isAcceptedChatImageType(record.mimeType) &&
    record.dataUrl.startsWith(`data:${record.mimeType};base64,`) &&
    record.dataUrl.length <= MAX_CHAT_IMAGE_DATA_URL_CHARS &&
    typeof record.name === 'string' &&
    typeof record.size === 'number' &&
    record.size > 0 &&
    record.size <= MAX_CHAT_IMAGE_BYTES
  );
}

function getBase64DecodedByteLength(body: string) {
  if (body.length === 0 || body.length % 4 !== 0) return null;

  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  const dataEnd = body.length - padding;

  for (let index = 0; index < dataEnd; index += 1) {
    const code = body.charCodeAt(index);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    const isSymbol = code === 43 || code === 47;
    if (!isUpper && !isLower && !isDigit && !isSymbol) return null;
  }

  for (let index = dataEnd; index < body.length; index += 1) {
    if (body[index] !== '=') return null;
  }

  return (body.length / 4) * 3 - padding;
}

function isChatFileMetadata(file: unknown): file is WireChatFileMetadata {
  if (typeof file !== 'object' || file === null) return false;

  const record = file as Record<string, unknown>;
  return (
    typeof record.mimeType === 'string' &&
    FILE_MIME_TYPE_PATTERN.test(record.mimeType) &&
    typeof record.name === 'string' &&
    record.name.trim().length > 0 &&
    record.name.length <= MAX_CHAT_ATTACHMENT_NAME_CHARS &&
    typeof record.size === 'number' &&
    Number.isInteger(record.size) &&
    record.size > 0 &&
    record.size <= MAX_CHAT_FILE_BYTES
  );
}

export function isWireChatPayload(payload: unknown): payload is WireChatPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  if (record.type !== 'CHAT_MESSAGE') return false;
  if (typeof record.message !== 'object' || record.message === null) return false;

  const message = record.message as Record<string, unknown>;
  if (!isBoundedIdentifier(message.id) || !isBoundedIdentifier(message.from)) return false;
  if (!isValidCreatedAt(message.createdAt)) return false;
  if (message.kind !== 'text' && message.kind !== 'image' && message.kind !== 'file' && message.kind !== 'mixed') return false;

  const hasText = isValidChatText(message.text);
  const hasImage = isChatImageAttachment(message.image);

  if (message.image !== undefined && !hasImage) return false;
  if (message.file !== undefined) return false;
  if (message.kind === 'text') return hasText && !message.image && !message.file;
  if (message.kind === 'image') return hasImage && !hasText && !message.file;
  if (message.kind === 'file') return false;
  return hasText && hasImage;
}

export function isWireChatAckPayload(payload: unknown): payload is WireChatAckPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return (
    record.type === 'CHAT_ACK' &&
    record.version === 1 &&
    isBoundedIdentifier(record.messageId) &&
    isBoundedIdentifier(record.from)
  );
}

function isNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBoundedIdentifier(value: unknown) {
  return isNonEmptyString(value) && (value as string).length <= 128;
}

function isValidCreatedAt(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidChatText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_CHAT_TEXT_CHARS;
}

export function isWireChatFileOfferPayload(payload: unknown): payload is WireChatFileOfferPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  if (record.type !== 'CHAT_FILE_OFFER' || record.version !== 1) return false;
  if (!isBoundedIdentifier(record.transferId) || !isBoundedIdentifier(record.from)) return false;
  if (typeof record.message !== 'object' || record.message === null) return false;

  const message = record.message as Record<string, unknown>;
  if (message.id !== record.transferId) return false;
  if (message.kind !== 'file' && message.kind !== 'mixed') return false;
  if (!isValidCreatedAt(message.createdAt)) return false;

  const hasText = isValidChatText(message.text);
  if (message.kind === 'file' && message.text !== undefined) return false;
  if (message.kind === 'mixed' && !hasText) return false;
  return isChatFileMetadata(message.file);
}

export function isWireChatFileAcceptPayload(payload: unknown): payload is WireChatFileAcceptPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  return (
    record.type === 'CHAT_FILE_ACCEPT' &&
    record.version === 2 &&
    isNonEmptyString(record.transferId) &&
    isNonEmptyString(record.from) &&
    (record.saveMode === 'file-system' || record.saveMode === 'memory') &&
    record.acknowledgedOffset === 0 &&
    isValidCreditBytes(record.creditBytes)
  );
}

export function isWireChatFileDeclinePayload(payload: unknown): payload is WireChatFileDeclinePayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  return (
    record.type === 'CHAT_FILE_DECLINE' &&
    record.version === 1 &&
    isNonEmptyString(record.transferId) &&
    isNonEmptyString(record.from)
  );
}

function isSafeByteOffset(value: unknown, allowZero = true) {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= MAX_CHAT_FILE_BYTES
  );
}

function isValidCreditBytes(value: unknown) {
  return isSafeByteOffset(value, false) && (value as number) <= CHAT_FILE_CREDIT_WINDOW_BYTES;
}

export function isWireChatFileCreditPayload(payload: unknown): payload is WireChatFileCreditPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  return (
    record.type === 'CHAT_FILE_CREDIT' &&
    record.version === 2 &&
    isNonEmptyString(record.transferId) &&
    isNonEmptyString(record.from) &&
    isSafeByteOffset(record.acknowledgedOffset) &&
    isValidCreditBytes(record.creditBytes) &&
    typeof record.resume === 'boolean'
  );
}

export function isWireChatFileCompletePayload(payload: unknown): payload is WireChatFileCompletePayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  return (
    record.type === 'CHAT_FILE_COMPLETE' &&
    record.version === 2 &&
    isNonEmptyString(record.transferId) &&
    isNonEmptyString(record.from) &&
    isSafeByteOffset(record.bytesReceived, false)
  );
}

export function isWireChatFileErrorPayload(payload: unknown): payload is WireChatFileErrorPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  return (
    record.type === 'CHAT_FILE_ERROR' &&
    record.version === 2 &&
    isNonEmptyString(record.transferId) &&
    isNonEmptyString(record.from) &&
    typeof record.message === 'string' &&
    record.message.trim().length > 0 &&
    record.message.length <= 240
  );
}

export function isWireChatFileChunkPayload(payload: unknown): payload is WireChatFileChunkPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  if (record.type !== 'CHAT_FILE_STREAM_CHUNK' || record.version !== 1) return false;
  if (!isNonEmptyString(record.transferId) || !isNonEmptyString(record.from)) return false;
  if (typeof record.chunk !== 'object' || record.chunk === null) return false;

  const chunk = record.chunk as Record<string, unknown>;
  if (typeof chunk.index !== 'number' || !Number.isSafeInteger(chunk.index)) return false;
  if (typeof chunk.offset !== 'number' || !Number.isSafeInteger(chunk.offset)) return false;
  if (typeof chunk.data !== 'string') return false;
  if (chunk.index < 0 || chunk.offset < 0) return false;
  if (chunk.offset >= MAX_CHAT_FILE_BYTES) return false;
  if (chunk.offset !== chunk.index * CHAT_FILE_STREAM_CHUNK_BYTES) return false;
  if (chunk.data.length <= 0 || chunk.data.length > CHAT_FILE_STREAM_CHUNK_DATA_CHARS) return false;
  const decodedByteLength = getBase64DecodedByteLength(chunk.data);
  return decodedByteLength !== null && decodedByteLength > 0 && decodedByteLength <= CHAT_FILE_STREAM_CHUNK_BYTES;
}

export function isSessionResumePayload(payload: unknown): payload is SessionResumePayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const record = payload as Record<string, unknown>;
  return (
    record.type === 'SESSION_RESUME' &&
    record.version === 1 &&
    typeof record.sessionId === 'string' &&
    isValidCallSessionId(record.sessionId) &&
    typeof record.peerId === 'string' &&
    isValidPeerId(record.peerId) &&
    (record.role === 'host' || record.role === 'guest')
  );
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
    file: payload.message.file,
    createdAt: payload.message.createdAt,
    status: 'received',
  };
}
