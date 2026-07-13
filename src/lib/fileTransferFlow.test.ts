import { describe, expect, it } from 'vitest';
import {
  FILE_TRANSFER_CREDIT_WINDOW_BYTES,
  advanceFileTransferWindow,
  applyFileTransferCredit,
  canSendFileChunk,
  createFileTransferSendWindow,
  resumeFileTransferWindow,
  type FileTransferSendWindow,
} from './fileTransferFlow';

const MIB = 1024 * 1024;

describe('fileTransferFlow', () => {
  it('starts without receiver credit', () => {
    expect(FILE_TRANSFER_CREDIT_WINDOW_BYTES).toBe(MIB);
    expect(createFileTransferSendWindow(4 * MIB)).toEqual({
      nextOffset: 0,
      acknowledgedOffset: 0,
      creditEnd: 0,
    });
    expect(canSendFileChunk(createFileTransferSendWindow(4 * MIB), 1, 4 * MIB)).toBe(false);
  });

  it('grants cumulative credit capped at the file size', () => {
    const initial = createFileTransferSendWindow(2 * MIB);
    const credited = applyFileTransferCredit(initial, {
      acknowledgedOffset: 0,
      creditBytes: MIB,
      fileSize: 2 * MIB,
    });

    expect(credited).toEqual({
      nextOffset: 0,
      acknowledgedOffset: 0,
      creditEnd: MIB,
    });
    expect(applyFileTransferCredit(credited, {
      acknowledgedOffset: 0,
      creditBytes: Number.MAX_SAFE_INTEGER,
      fileSize: 2 * MIB,
    }).creditEnd).toBe(2 * MIB);
  });

  it('does not regress offsets or revoke credit for a stale ACK', () => {
    const sent = advanceFileTransferWindow({
      nextOffset: 512,
      acknowledgedOffset: 256,
      creditEnd: 1_024,
    }, 256, 2_048);

    const updated = applyFileTransferCredit(sent, {
      acknowledgedOffset: 128,
      creditBytes: 64,
      fileSize: 2_048,
    });

    expect(updated).toEqual({
      nextOffset: 768,
      acknowledgedOffset: 256,
      creditEnd: 1_024,
    });
  });

  it('advances an ACK only through bytes already sent', () => {
    const window: FileTransferSendWindow = {
      nextOffset: 768,
      acknowledgedOffset: 256,
      creditEnd: 1_024,
    };

    expect(applyFileTransferCredit(window, {
      acknowledgedOffset: 640,
      creditBytes: 512,
      fileSize: 2_048,
    })).toEqual({
      nextOffset: 768,
      acknowledgedOffset: 640,
      creditEnd: 1_152,
    });

    expect(() => applyFileTransferCredit(window, {
      acknowledgedOffset: 769,
      creditBytes: 512,
      fileSize: 2_048,
    })).toThrow(/acknowledgedOffset/i);
  });

  it('allows chunks only inside both receiver credit and file bounds', () => {
    const window: FileTransferSendWindow = {
      nextOffset: 768,
      acknowledgedOffset: 512,
      creditEnd: 1_024,
    };

    expect(canSendFileChunk(window, 256, 2_048)).toBe(true);
    expect(canSendFileChunk(window, 257, 2_048)).toBe(false);
    expect(canSendFileChunk(window, 0, 2_048)).toBe(false);
    expect(canSendFileChunk({ ...window, creditEnd: 2_048 }, 1_281, 2_048)).toBe(false);
  });

  it('advances legal chunks without mutating the previous window', () => {
    const window: FileTransferSendWindow = {
      nextOffset: 256,
      acknowledgedOffset: 128,
      creditEnd: 1_024,
    };

    expect(advanceFileTransferWindow(window, 512, 2_048)).toEqual({
      nextOffset: 768,
      acknowledgedOffset: 128,
      creditEnd: 1_024,
    });
    expect(window.nextOffset).toBe(256);
  });

  it('rejects attempts to advance an illegal chunk', () => {
    const window: FileTransferSendWindow = {
      nextOffset: 768,
      acknowledgedOffset: 512,
      creditEnd: 1_024,
    };

    expect(() => advanceFileTransferWindow(window, 0, 2_048)).toThrow(/chunk/i);
    expect(() => advanceFileTransferWindow(window, 257, 2_048)).toThrow(/credit/i);
    expect(() => advanceFileTransferWindow({ ...window, creditEnd: 2_048 }, 1_281, 2_048)).toThrow(/file/i);
  });

  it('resumes exactly at the persisted receiver offset with fresh credit', () => {
    const window: FileTransferSendWindow = {
      nextOffset: 1_024,
      acknowledgedOffset: 768,
      creditEnd: 1_536,
    };

    expect(resumeFileTransferWindow(window, {
      persistedOffset: 512,
      creditBytes: 256,
      fileSize: 2_048,
    })).toEqual({
      nextOffset: 512,
      acknowledgedOffset: 512,
      creditEnd: 768,
    });

    expect(resumeFileTransferWindow(createFileTransferSendWindow(2_048), {
      persistedOffset: 1_920,
      creditBytes: 512,
      fileSize: 2_048,
    })).toEqual({
      nextOffset: 1_920,
      acknowledgedOffset: 1_920,
      creditEnd: 2_048,
    });
  });

  it('rejects unsafe, negative, and inconsistent numeric state', () => {
    expect(() => createFileTransferSendWindow(-1)).toThrow();
    expect(() => createFileTransferSendWindow(1.5)).toThrow();
    expect(() => createFileTransferSendWindow(Number.MAX_SAFE_INTEGER + 1)).toThrow();

    const valid = createFileTransferSendWindow(1_024);
    expect(() => applyFileTransferCredit(valid, {
      acknowledgedOffset: 0,
      creditBytes: -1,
      fileSize: 1_024,
    })).toThrow();
    expect(() => resumeFileTransferWindow(valid, {
      persistedOffset: 1_025,
      creditBytes: 1,
      fileSize: 1_024,
    })).toThrow();
    expect(() => canSendFileChunk({
      nextOffset: 512,
      acknowledgedOffset: 513,
      creditEnd: 1_024,
    }, 1, 1_024)).toThrow();
    expect(() => canSendFileChunk(valid, Number.NaN, 1_024)).toThrow();
  });
});
