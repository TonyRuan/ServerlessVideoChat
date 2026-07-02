import { describe, expect, it } from 'vitest';
import {
  canUseMemoryFileFallback,
  getFileTransferLimitLabel,
  getMemoryFileFallbackLimitLabel,
} from './fileTransferLimits';
import {
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES,
} from './chatStorage';

describe('fileTransferLimits', () => {
  it('formats the transfer cap as 2 GB', () => {
    expect(getFileTransferLimitLabel()).toBe('2 GB');
  });

  it('keeps unsupported browser memory fallback at 10 MB', () => {
    expect(getMemoryFileFallbackLimitLabel()).toBe('10 MB');
    expect(canUseMemoryFileFallback(MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES)).toBe(true);
    expect(canUseMemoryFileFallback(MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES + 1)).toBe(false);
    expect(canUseMemoryFileFallback(MAX_CHAT_FILE_BYTES)).toBe(false);
  });
});
