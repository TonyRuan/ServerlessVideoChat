import {
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES,
} from './chatStorage';

const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB * 1024;
const BYTES_PER_GIB = BYTES_PER_MIB * 1024;

const formatLimitNumber = (value: number) => (
  Number.isInteger(value) ? String(value) : value.toFixed(1)
);

export function formatFileTransferBytes(bytes: number) {
  if (bytes >= BYTES_PER_GIB) {
    return `${formatLimitNumber(bytes / BYTES_PER_GIB)} GB`;
  }

  if (bytes >= BYTES_PER_MIB) {
    return `${formatLimitNumber(bytes / BYTES_PER_MIB)} MB`;
  }

  return `${Math.ceil(bytes / BYTES_PER_KIB)} KB`;
}

export function getFileTransferLimitLabel() {
  return formatFileTransferBytes(MAX_CHAT_FILE_BYTES);
}

export function getMemoryFileFallbackLimitLabel() {
  return formatFileTransferBytes(MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES);
}

export function canUseMemoryFileFallback(fileSize: number) {
  return fileSize <= MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES;
}
