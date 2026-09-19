import { describe, expect, it, vi } from 'vitest';
import { createChatCryptoSession } from './chatCrypto';
import type { FileTransferMode } from './chatStorage';
import { CHAT_FILE_STREAM_CHUNK_BYTES as CHUNK } from './chatProtocol';
import { applyFileTransferCredit, createFileTransferSendWindow, resumeFileTransferWindow } from './fileTransferFlow';
import { waitForFileDataChannelBuffer } from './fileTransferBackpressure';
import { createFileCreditPublisher, createFileTransferResumePayloads, decodeFileTransferPayload, encodeFileTransferPayload, getFileTransferCreditBytes, pumpFileTransfer } from './fileTransferTransport';

async function sessions() {
  const sender = await createChatCryptoSession();
  const receiver = await createChatCryptoSession();
  await sender.acceptPeerPublicKey(receiver.publicKey);
  await receiver.acceptPeerPublicKey(sender.publicKey);
  return { sender, receiver };
}

describe('file transfer transport', () => {
  it.each<FileTransferMode>(['encrypted', 'fast'])('replays lost acceptance with the agreed %s mode on zero-byte resume', (mode) => {
    const payloads = createFileTransferResumePayloads('file', 'bob', 0, mode, 'file-system');
    expect(payloads[0].type).toBe('CHAT_FILE_ACCEPT');
    expect('mode' in payloads[0] ? payloads[0].mode : 'encrypted').toBe(mode);
    expect(payloads[1]).toMatchObject({ type: 'CHAT_FILE_CREDIT', resume: true, acknowledgedOffset: 0 });
    expect(createFileTransferResumePayloads('file', 'bob', CHUNK, mode, 'file-system')).toHaveLength(1);
  });
  it.each<FileTransferMode>(['encrypted', 'fast'])('transfers multiple windows byte-for-byte in %s mode, including a partial last chunk', async (mode) => {
    const { sender, receiver } = await sessions();
    const encrypt = vi.spyOn(sender, 'encryptBytes');
    const decrypt = vi.spyOn(receiver, 'decryptBytes');
    const creditBytes = getFileTransferCreditBytes(mode);
    const source = Uint8Array.from({ length: creditBytes * 2 + 37 }, (_, index) => index % 251);
    const result = new Uint8Array(source.length);
    const transfer = { file: new Blob([source]), mode, window: createFileTransferSendWindow(source.length) };
    transfer.window = applyFileTransferCredit(transfer.window, { acknowledgedOffset: 0, creditBytes, fileSize: source.length });
    const progress: number[] = [];
    let persisted = 0;
    let pumps = 0;
    while (persisted < source.length) {
      await pumpFileTransfer({
        transfer, transferId: 'file-1', from: 'alice', session: sender, isCurrent: () => true,
        send: async (wire) => {
          // PeerJS's binary unpacker returns ArrayBuffer for typed arrays.
          const data = wire instanceof Uint8Array ? wire.buffer : wire;
          const frame = await decodeFileTransferPayload(data, receiver, 'alice', () => mode);
          expect(frame?.offset).toBe(persisted);
          result.set(frame!.data, persisted);
          persisted += frame!.data.length;
        },
        onProgress: (bytes) => progress.push(bytes),
      });
      pumps++;
      transfer.window = applyFileTransferCredit(transfer.window, { acknowledgedOffset: persisted, creditBytes, fileSize: source.length });
    }
    expect(pumps).toBeGreaterThan(1);
    expect(Buffer.compare(Buffer.from(source), Buffer.from(result))).toBe(0);
    expect(progress.every((value, i) => i === 0 || value > progress[i - 1])).toBe(true);
    expect(progress.at(-1)).toBe(source.length);
    expect(encrypt.mock.calls.length > 0).toBe(mode === 'encrypted');
    expect(decrypt.mock.calls.length > 0).toBe(mode === 'encrypted');
  });

  it('accepts an early ACK while send/drain has not returned', async () => {
    const { sender } = await sessions();
    const file = new Blob([new Uint8Array(CHUNK * 3)]);
    const transfer = { file, mode: 'fast' as const, window: resumeFileTransferWindow(createFileTransferSendWindow(file.size), { persistedOffset: 0, creditBytes: CHUNK, fileSize: file.size }) };
    await pumpFileTransfer({
      transfer, transferId: 'file', from: 'alice', session: sender, isCurrent: () => true,
      send: async () => {
        expect(transfer.window.nextOffset).toBeGreaterThan(transfer.window.acknowledgedOffset);
        transfer.window = applyFileTransferCredit(transfer.window, { acknowledgedOffset: transfer.window.nextOffset, creditBytes: CHUNK, fileSize: file.size });
        await Promise.resolve();
      },
      onProgress: () => undefined,
    });
    expect(transfer.window.acknowledgedOffset).toBe(file.size);
  });

  it('never accepts unsolicited, wrong-peer or mismatched-mode file data', async () => {
    const { sender, receiver } = await sessions();
    const frame = { transferId: 'file', from: 'alice', index: 0, offset: 0, data: new Uint8Array([1, 2, 3]) };
    const fast = await encodeFileTransferPayload(frame, 'fast', sender);
    const encrypted = await encodeFileTransferPayload(frame, 'encrypted', sender);
    expect(await decodeFileTransferPayload(fast, receiver, 'alice', () => undefined)).toBeNull();
    expect(await decodeFileTransferPayload(fast, receiver, 'bob', () => 'fast')).toBeNull();
    expect(await decodeFileTransferPayload(fast, receiver, 'alice', () => 'encrypted')).toBeNull();
    expect(await decodeFileTransferPayload(encrypted, receiver, 'alice', () => 'fast')).toBeNull();
  });

  it('cancels a stale pump after encryption and resumes only from persisted bytes', async () => {
    const { sender } = await sessions();
    let current = true;
    const originalEncrypt = sender.encryptBytes;
    vi.spyOn(sender, 'encryptBytes').mockImplementation(async (data) => {
      const result = await originalEncrypt(data);
      current = false;
      return result;
    });
    const file = new Blob([new Uint8Array(CHUNK * 3)]);
    const transfer = { file, mode: 'encrypted' as FileTransferMode, window: resumeFileTransferWindow(createFileTransferSendWindow(file.size), { persistedOffset: 0, creditBytes: CHUNK * 3, fileSize: file.size }) };
    const send = vi.fn(async () => undefined);
    await pumpFileTransfer({ transfer, transferId: 'file', from: 'alice', session: sender, isCurrent: () => current, send, onProgress: () => undefined });
    expect(send).not.toHaveBeenCalled();
    expect(transfer.window.nextOffset).toBe(0);
    current = true;
    transfer.mode = 'fast';
    transfer.window = resumeFileTransferWindow(transfer.window, { persistedOffset: CHUNK, creditBytes: CHUNK * 3, fileSize: file.size });
    await pumpFileTransfer({ transfer, transferId: 'file', from: 'alice', session: sender, isCurrent: () => current, send, onProgress: () => undefined });
    expect(send).toHaveBeenCalledTimes(2);
    expect(transfer.window.nextOffset).toBe(file.size);
  });

  it('does not read disk without credit', async () => {
    const { sender } = await sessions();
    const file = new Blob([new Uint8Array(CHUNK)]);
    const slice = vi.spyOn(file, 'slice');
    await pumpFileTransfer({ transfer: { file, mode: 'fast', window: createFileTransferSendWindow(file.size) }, transferId: 'file', from: 'alice', session: sender, isCurrent: () => true, send: async () => undefined, onProgress: () => undefined });
    expect(slice).not.toHaveBeenCalled();
  });

  it.each([0, CHUNK])('stops a pump blocked on browser drain and resumes from persisted offset %i', async (persistedOffset) => {
    const { sender, receiver } = await sessions();
    const file = new Blob([new Uint8Array(CHUNK * 3)]);
    const transfer = {
      file, mode: 'fast' as const,
      window: resumeFileTransferWindow(createFileTransferSendWindow(file.size), {
        persistedOffset: 0, creditBytes: file.size, fileSize: file.size,
      }),
    };
    const channel = Object.assign(new EventTarget(), {
      readyState: 'open' as RTCDataChannelState,
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
    });
    let generation = Symbol();
    const firstGeneration = generation;
    const isCurrent = () => generation === firstGeneration;
    const progress = vi.fn();
    let started!: () => void;
    const waitingForDrain = new Promise<void>((resolve) => { started = resolve; });
    const offsets: number[] = [];
    const send = vi.fn(async (payload: Awaited<ReturnType<typeof encodeFileTransferPayload>>) => {
      const frame = await decodeFileTransferPayload(payload, receiver, 'alice', () => 'fast');
      offsets.push(frame!.offset);
      channel.bufferedAmount = CHUNK + 1;
      const drain = waitForFileDataChannelBuffer(channel, { isCurrent });
      started();
      await drain;
    });

    vi.useFakeTimers();
    try {
      const pump = pumpFileTransfer({
        transfer, transferId: 'file', from: 'alice', session: sender,
        isCurrent, send, onProgress: progress,
      });
      const cancelled = expect(pump).rejects.toMatchObject({ name: 'AbortError' });
      await waitingForDrain;
      expect(send).toHaveBeenCalledOnce();
      expect(offsets).toEqual([0]);
      expect(transfer.window.nextOffset).toBe(CHUNK);
      expect(progress).not.toHaveBeenCalled();

      // A replacement run must cancel the wait even if no low-water event arrives.
      generation = Symbol();
      await vi.advanceTimersByTimeAsync(250);
      await cancelled;
      expect(vi.getTimerCount()).toBe(0);
      channel.bufferedAmount = 0;
      channel.dispatchEvent(new Event('bufferedamountlow'));
      expect(send).toHaveBeenCalledOnce();
      expect(progress).not.toHaveBeenCalled();

      // The browser accepted the first send, but only the receiver knows whether
      // it reached disk. Replay it when unpersisted; skip it only when confirmed.
      transfer.window = resumeFileTransferWindow(transfer.window, {
        persistedOffset, creditBytes: file.size, fileSize: file.size,
      });
      const resumedGeneration = generation;
      const resumedOffsets: number[] = [];
      await pumpFileTransfer({
        transfer, transferId: 'file', from: 'alice', session: sender,
        isCurrent: () => generation === resumedGeneration,
        send: async (payload) => {
          const frame = await decodeFileTransferPayload(payload, receiver, 'alice', () => 'fast');
          resumedOffsets.push(frame!.offset);
          await waitForFileDataChannelBuffer(channel, { isCurrent: () => generation === resumedGeneration });
        },
        onProgress: progress,
      });
      expect(resumedOffsets).toEqual(persistedOffset === 0 ? [0, CHUNK, CHUNK * 2] : [CHUNK, CHUNK * 2]);
      expect(progress.mock.calls.map(([bytes]) => bytes)).toEqual(
        persistedOffset === 0 ? [CHUNK, CHUNK * 2, CHUNK * 3] : [CHUNK * 2, CHUNK * 3],
      );
      expect(transfer.window.nextOffset).toBe(file.size);
      expect(send).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('coalesces credit while control send is blocked without blocking writes', async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    let current = true;
    const publish = createFileCreditPublisher({ creditBytes: CHUNK * 8, send, isCurrent: () => current });
    publish(CHUNK);
    expect(send).not.toHaveBeenCalled();
    publish(CHUNK * 2);
    publish(CHUNK * 4);
    publish(CHUNK * 6);
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    expect(send).toHaveBeenLastCalledWith(CHUNK * 6);
    current = false;
    publish(CHUNK * 8);
    finish();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
