export const FILE_TRANSFER_CREDIT_WINDOW_BYTES = 1024 * 1024;

export interface FileTransferSendWindow {
  nextOffset: number;
  acknowledgedOffset: number;
  creditEnd: number;
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertWindow(window: FileTransferSendWindow, fileSize: number): void {
  assertNonNegativeSafeInteger(fileSize, 'fileSize');
  assertNonNegativeSafeInteger(window.nextOffset, 'nextOffset');
  assertNonNegativeSafeInteger(window.acknowledgedOffset, 'acknowledgedOffset');
  assertNonNegativeSafeInteger(window.creditEnd, 'creditEnd');

  if (window.acknowledgedOffset > window.nextOffset) {
    throw new RangeError('acknowledgedOffset cannot exceed nextOffset');
  }
  if (window.nextOffset > window.creditEnd) {
    throw new RangeError('nextOffset cannot exceed creditEnd');
  }
  if (window.creditEnd > fileSize) {
    throw new RangeError('creditEnd cannot exceed fileSize');
  }
}

function calculateCreditEnd(offset: number, creditBytes: number, fileSize: number): number {
  if (creditBytes >= fileSize - offset) {
    return fileSize;
  }

  return offset + creditBytes;
}

export function createFileTransferSendWindow(fileSize: number): FileTransferSendWindow {
  assertNonNegativeSafeInteger(fileSize, 'fileSize');

  return {
    nextOffset: 0,
    acknowledgedOffset: 0,
    creditEnd: 0,
  };
}

export function applyFileTransferCredit(
  window: FileTransferSendWindow,
  input: {
    acknowledgedOffset: number;
    creditBytes: number;
    fileSize: number;
  },
): FileTransferSendWindow {
  assertWindow(window, input.fileSize);
  assertNonNegativeSafeInteger(input.acknowledgedOffset, 'acknowledgedOffset');
  assertNonNegativeSafeInteger(input.creditBytes, 'creditBytes');

  if (input.acknowledgedOffset > window.nextOffset) {
    throw new RangeError('acknowledgedOffset cannot exceed nextOffset');
  }

  const acknowledgedOffset = Math.max(
    window.acknowledgedOffset,
    input.acknowledgedOffset,
  );
  const grantedCreditEnd = calculateCreditEnd(
    acknowledgedOffset,
    input.creditBytes,
    input.fileSize,
  );

  return {
    nextOffset: window.nextOffset,
    acknowledgedOffset,
    creditEnd: Math.max(window.creditEnd, grantedCreditEnd),
  };
}

export function resumeFileTransferWindow(
  window: FileTransferSendWindow,
  input: {
    persistedOffset: number;
    creditBytes: number;
    fileSize: number;
  },
): FileTransferSendWindow {
  assertWindow(window, input.fileSize);
  assertNonNegativeSafeInteger(input.persistedOffset, 'persistedOffset');
  assertNonNegativeSafeInteger(input.creditBytes, 'creditBytes');

  if (input.persistedOffset > input.fileSize) {
    throw new RangeError('persistedOffset cannot exceed fileSize');
  }

  return {
    nextOffset: input.persistedOffset,
    acknowledgedOffset: input.persistedOffset,
    creditEnd: calculateCreditEnd(
      input.persistedOffset,
      input.creditBytes,
      input.fileSize,
    ),
  };
}

export function canSendFileChunk(
  window: FileTransferSendWindow,
  byteLength: number,
  fileSize: number,
): boolean {
  assertWindow(window, fileSize);
  assertNonNegativeSafeInteger(byteLength, 'byteLength');

  if (byteLength === 0) {
    return false;
  }

  return byteLength <= window.creditEnd - window.nextOffset
    && byteLength <= fileSize - window.nextOffset;
}

export function advanceFileTransferWindow(
  window: FileTransferSendWindow,
  byteLength: number,
  fileSize: number,
): FileTransferSendWindow {
  assertWindow(window, fileSize);
  assertNonNegativeSafeInteger(byteLength, 'byteLength');

  if (byteLength === 0) {
    throw new RangeError('chunk byteLength must be greater than zero');
  }
  if (byteLength > fileSize - window.nextOffset) {
    throw new RangeError('chunk exceeds file size');
  }
  if (byteLength > window.creditEnd - window.nextOffset) {
    throw new RangeError('chunk exceeds receiver credit');
  }

  return {
    ...window,
    nextOffset: window.nextOffset + byteLength,
  };
}
