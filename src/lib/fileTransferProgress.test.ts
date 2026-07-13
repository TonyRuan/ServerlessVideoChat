import { describe, expect, it } from 'vitest';
import {
  canBufferPendingFileChunk,
  claimOutgoingFileTransferStart,
  classifyIncomingFileChunk,
  isValidIncomingFileChunkLength,
  shouldPublishFileTransferProgress,
  takeContiguousPendingFileChunks,
} from './fileTransferProgress';

describe('fileTransferProgress', () => {
  it('classifies the next expected chunk', () => {
    expect(classifyIncomingFileChunk({
      offset: 64,
      byteLength: 32,
      expectedOffset: 64,
      fileSize: 128,
    })).toBe('next');
  });

  it('treats fully received duplicate chunks as duplicates', () => {
    expect(classifyIncomingFileChunk({
      offset: 0,
      byteLength: 32,
      expectedOffset: 64,
      fileSize: 128,
    })).toBe('duplicate');
  });

  it('rejects gaps, overlaps, and overflow chunks', () => {
    expect(classifyIncomingFileChunk({
      offset: 96,
      byteLength: 32,
      expectedOffset: 64,
      fileSize: 128,
    })).toBe('gap');
    expect(classifyIncomingFileChunk({
      offset: 48,
      byteLength: 32,
      expectedOffset: 64,
      fileSize: 128,
    })).toBe('overlap');
    expect(classifyIncomingFileChunk({
      offset: 112,
      byteLength: 32,
      expectedOffset: 112,
      fileSize: 128,
    })).toBe('overflow');
  });

  it('validates full middle chunks and partial final chunks', () => {
    expect(isValidIncomingFileChunkLength({
      offset: 64,
      byteLength: 32,
      fileSize: 128,
      chunkBytes: 32,
    })).toBe(true);
    expect(isValidIncomingFileChunkLength({
      offset: 64,
      byteLength: 16,
      fileSize: 128,
      chunkBytes: 32,
    })).toBe(false);
    expect(isValidIncomingFileChunkLength({
      offset: 96,
      byteLength: 20,
      fileSize: 116,
      chunkBytes: 32,
    })).toBe(true);
    expect(isValidIncomingFileChunkLength({
      offset: 96,
      byteLength: 32,
      fileSize: 116,
      chunkBytes: 32,
    })).toBe(false);
  });

  it('keeps pending out-of-order chunks bounded', () => {
    expect(canBufferPendingFileChunk({
      pendingBytes: 64,
      byteLength: 32,
      limitBytes: 96,
    })).toBe(true);
    expect(canBufferPendingFileChunk({
      pendingBytes: 64,
      byteLength: 33,
      limitBytes: 96,
    })).toBe(false);
  });

  it('claims an outgoing transfer start only once', () => {
    const transfer = { isStarted: false };

    expect(claimOutgoingFileTransferStart(transfer)).toBe(true);
    expect(claimOutgoingFileTransferStart(transfer)).toBe(false);
    expect(transfer.isStarted).toBe(true);
  });

  it('takes buffered chunks once their missing predecessor arrives', () => {
    const pendingChunks = new Map<number, Uint8Array>([
      [96, new Uint8Array([4, 5, 6])],
      [99, new Uint8Array([7, 8])],
    ]);

    expect(takeContiguousPendingFileChunks(pendingChunks, 64)).toEqual([]);
    expect(takeContiguousPendingFileChunks(pendingChunks, 96)).toEqual([
      { offset: 96, bytes: new Uint8Array([4, 5, 6]) },
      { offset: 99, bytes: new Uint8Array([7, 8]) },
    ]);
    expect(pendingChunks.size).toBe(0);
  });

  it('publishes transfer progress only after time, byte, or completion thresholds', () => {
    const snapshot = {
      lastUpdateAt: 1_000,
      lastUpdateBytes: 2 * 1024 * 1024,
    };

    expect(shouldPublishFileTransferProgress({
      bytesTransferred: 2 * 1024 * 1024 + 256 * 1024,
      totalBytes: 10 * 1024 * 1024,
      snapshot,
      now: 1_100,
    })).toBe(false);

    expect(shouldPublishFileTransferProgress({
      bytesTransferred: 2 * 1024 * 1024 + 256 * 1024,
      totalBytes: 10 * 1024 * 1024,
      snapshot,
      now: 1_250,
    })).toBe(true);

    expect(shouldPublishFileTransferProgress({
      bytesTransferred: 3 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      snapshot,
      now: 1_100,
    })).toBe(true);

    expect(shouldPublishFileTransferProgress({
      bytesTransferred: 10 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      snapshot,
      now: 1_100,
    })).toBe(true);
  });
});
