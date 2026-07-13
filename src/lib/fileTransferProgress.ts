export type IncomingFileChunkClass = 'next' | 'duplicate' | 'gap' | 'overlap' | 'overflow';

export interface IncomingFileChunkProgress {
  offset: number;
  byteLength: number;
  expectedOffset: number;
  fileSize: number;
}

export function classifyIncomingFileChunk({
  offset,
  byteLength,
  expectedOffset,
  fileSize,
}: IncomingFileChunkProgress): IncomingFileChunkClass {
  const nextOffset = offset + byteLength;

  if (offset === expectedOffset) {
    return nextOffset <= fileSize ? 'next' : 'overflow';
  }

  if (offset < expectedOffset) {
    return nextOffset <= expectedOffset ? 'duplicate' : 'overlap';
  }

  return nextOffset <= fileSize ? 'gap' : 'overflow';
}

export interface OutgoingFileTransferStartState {
  isStarted: boolean;
}

export function claimOutgoingFileTransferStart(transfer: OutgoingFileTransferStartState) {
  if (transfer.isStarted) return false;
  transfer.isStarted = true;
  return true;
}

export interface IncomingFileChunkLength {
  offset: number;
  byteLength: number;
  fileSize: number;
  chunkBytes: number;
}

export function isValidIncomingFileChunkLength({
  offset,
  byteLength,
  fileSize,
  chunkBytes,
}: IncomingFileChunkLength) {
  const remainingBytes = fileSize - offset;
  if (remainingBytes <= 0) return false;

  return byteLength === Math.min(chunkBytes, remainingBytes);
}

export interface PendingFileChunkBudget {
  pendingBytes: number;
  byteLength: number;
  limitBytes: number;
}

export function canBufferPendingFileChunk({
  pendingBytes,
  byteLength,
  limitBytes,
}: PendingFileChunkBudget) {
  return pendingBytes + byteLength <= limitBytes;
}

export interface PendingIncomingFileChunk {
  offset: number;
  bytes: Uint8Array;
}

export function takeContiguousPendingFileChunks(
  pendingChunks: Map<number, Uint8Array>,
  expectedOffset: number
) {
  const chunks: PendingIncomingFileChunk[] = [];
  let offset = expectedOffset;

  while (pendingChunks.has(offset)) {
    const bytes = pendingChunks.get(offset);
    if (!bytes) break;

    pendingChunks.delete(offset);
    chunks.push({ offset, bytes });
    offset += bytes.byteLength;
  }

  return chunks;
}

export const FILE_TRANSFER_PROGRESS_UPDATE_INTERVAL_MS = 250;
export const FILE_TRANSFER_PROGRESS_UPDATE_BYTES = 1024 * 1024;

export interface FileTransferProgressSnapshot {
  lastUpdateAt: number;
  lastUpdateBytes: number;
}

export interface FileTransferProgressPublishInput {
  bytesTransferred: number;
  totalBytes: number;
  snapshot: FileTransferProgressSnapshot;
  now?: number;
  intervalMs?: number;
  byteDelta?: number;
}

export function shouldPublishFileTransferProgress({
  bytesTransferred,
  totalBytes,
  snapshot,
  now = Date.now(),
  intervalMs = FILE_TRANSFER_PROGRESS_UPDATE_INTERVAL_MS,
  byteDelta = FILE_TRANSFER_PROGRESS_UPDATE_BYTES,
}: FileTransferProgressPublishInput) {
  if (bytesTransferred <= 0) return true;
  if (bytesTransferred >= totalBytes) return true;
  if (now - snapshot.lastUpdateAt >= intervalMs) return true;
  return bytesTransferred - snapshot.lastUpdateBytes >= byteDelta;
}
