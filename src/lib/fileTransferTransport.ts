import type { FileTransferMode } from './chatStorage';
import { CHAT_FILE_STREAM_CHUNK_BYTES, createWireChatFileAccept, createWireChatFileCredit, type WireChatFileSaveMode } from './chatProtocol';
import { isEncryptedBinaryChatEnvelope, type ChatCryptoSession } from './chatCrypto';
import { decodeFileChunkFrame, encodeFileChunkFrame, type BinaryFileChunkFrame } from './fileTransferBinary';
import { advanceFileTransferWindow, canSendFileChunk, type FileTransferSendWindow } from './fileTransferFlow';

export const FAST_FILE_TRANSFER_CREDIT_BYTES = 8 * 1024 * 1024;
export const getFileTransferCreditBytes = (mode: FileTransferMode) => (
  mode === 'fast' ? FAST_FILE_TRANSFER_CREDIT_BYTES : 1024 * 1024
);

export function createFileTransferResumePayloads(
  transferId: string, from: string, persistedOffset: number, mode: FileTransferMode, saveMode: WireChatFileSaveMode,
) {
  const credit = getFileTransferCreditBytes(mode);
  return [
    // ACCEPT may have been lost before the first byte arrived. Preserve explicit mode agreement.
    ...(persistedOffset === 0 ? [createWireChatFileAccept(transferId, from, saveMode, credit, mode)] : []),
    createWireChatFileCredit(transferId, from, persistedOffset, credit, true),
  ];
}

export async function encodeFileTransferPayload(
  frame: BinaryFileChunkFrame,
  mode: FileTransferMode,
  session: ChatCryptoSession,
) {
  const bytes = encodeFileChunkFrame(frame);
  return mode === 'fast' ? bytes : session.encryptBytes(bytes);
}

export async function decodeFileTransferPayload(
  data: unknown,
  session: ChatCryptoSession,
  peer: string,
  acceptedMode: (transferId: string) => FileTransferMode | undefined,
) {
  const encrypted = isEncryptedBinaryChatEnvelope(data);
  const bytes = encrypted
    ? await session.decryptBytes(data)
    : data instanceof Uint8Array ? data
      : data instanceof ArrayBuffer ? new Uint8Array(data) : null;
  if (!bytes) return null;
  const frame = decodeFileChunkFrame(bytes);
  if (frame.from !== peer || acceptedMode(frame.transferId) !== (encrypted ? 'encrypted' : 'fast')) return null;
  return frame;
}

/** Bounded pump. Reserve sent bytes before asynchronous drain so early ACKs are valid. */
export async function pumpFileTransfer({
  transfer, transferId, from, session, isCurrent, send, onProgress,
}: {
  transfer: { file: Blob; mode: FileTransferMode; window: FileTransferSendWindow };
  transferId: string;
  from: string;
  session: ChatCryptoSession;
  isCurrent: () => boolean;
  send: (payload: Awaited<ReturnType<typeof encodeFileTransferPayload>>) => Promise<void>;
  onProgress: (bytesSent: number) => void;
}) {
  while (isCurrent() && transfer.window.nextOffset < transfer.file.size) {
    const offset = transfer.window.nextOffset;
    const length = Math.min(CHAT_FILE_STREAM_CHUNK_BYTES, transfer.file.size - offset);
    // Do not read the same chunk repeatedly while waiting for receiver credit.
    if (!canSendFileChunk(transfer.window, length, transfer.file.size)) return;
    const bytes = new Uint8Array(await transfer.file.slice(offset, offset + length).arrayBuffer());
    if (!isCurrent()) return;
    const payload = await encodeFileTransferPayload({
      transferId, from, index: offset / CHAT_FILE_STREAM_CHUNK_BYTES, offset, data: bytes,
    }, transfer.mode, session);
    if (!isCurrent()) return;
    transfer.window = advanceFileTransferWindow(transfer.window, length, transfer.file.size);
    await send(payload);
    if (!isCurrent()) return;
    onProgress(transfer.window.nextOffset);
  }
}

/** At most one credit send in flight; disk writes never wait for control-channel drain. */
export function createFileCreditPublisher({
  creditBytes, send, isCurrent,
}: {
  creditBytes: number;
  send: (offset: number) => Promise<void>;
  isCurrent: () => boolean;
}) {
  let latestOffset = 0;
  let publishedOffset = 0;
  let publishing = false;
  const publish = async () => {
    if (publishing) return;
    publishing = true;
    try {
      while (isCurrent() && latestOffset - publishedOffset >= creditBytes / 4) {
        const offset = latestOffset;
        await send(offset);
        publishedOffset = offset;
      }
    } catch {
      // Recovery advertises the persisted offset and a fresh credit window.
    } finally {
      publishing = false;
    }
  };
  return (offset: number) => {
    latestOffset = Math.max(latestOffset, offset);
    void publish();
  };
}
