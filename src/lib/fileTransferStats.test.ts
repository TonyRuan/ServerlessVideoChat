import { describe, expect, it } from 'vitest';
import {
  formatFileTransferSpeed,
  formatFileTransferTimeRemaining,
} from './fileTransferStats';

describe('fileTransferStats', () => {
  it('formats transfer speed in useful units', () => {
    expect(formatFileTransferSpeed(512)).toBe('512 B/s');
    expect(formatFileTransferSpeed(1536)).toBe('1.5 KB/s');
    expect(formatFileTransferSpeed(2.5 * 1024 * 1024)).toBe('2.5 MB/s');
  });

  it('formats remaining transfer time', () => {
    expect(formatFileTransferTimeRemaining(12)).toBe('12 秒');
    expect(formatFileTransferTimeRemaining(75)).toBe('1 分 15 秒');
    expect(formatFileTransferTimeRemaining(3665)).toBe('1 小时 1 分');
  });
});
