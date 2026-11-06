import { Capacitor } from '@capacitor/core';
import { isEncryptedBinaryChatEnvelope, type EncryptedBinaryChatEnvelope } from './chatCrypto';

export const LIGHTNING_MAX_FRAME_BYTES = 256 * 1024 + 4096 + 28;
const CONNECT_TIMEOUT_MS = 20_000;
const IO_TIMEOUT_MS = 30_000;
const FAILURE_MESSAGE = '闪电通道已断开，请重新发送或选择其他模式';

export interface LightningChannel {
  send: (payload: EncryptedBinaryChatEnvelope) => Promise<void>;
  receive: (onPayload: (payload: EncryptedBinaryChatEnvelope) => Promise<void>) => Promise<void>;
  close: () => void;
  /** Resolves on local close; rejects on unexpected session loss or timeout. */
  closed: Promise<void>;
}

export function getLightningRelayUrl(): string | null {
  const configured = import.meta.env.VITE_WEBTRANSPORT_URL;
  if (typeof configured !== 'string' || !configured.trim()) return null;
  try {
    const url = new URL(configured.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function getLightningAvailability(): { available: boolean; reason?: string } {
  if (Capacitor.isNativePlatform()) return { available: false, reason: '实验闪电模式目前仅支持网页版' };
  if (!getLightningRelayUrl()) return { available: false, reason: '闪电中转服务尚未配置' };
  if (!globalThis.isSecureContext || typeof globalThis.WebTransport !== 'function') {
    return { available: false, reason: '当前浏览器不支持闪电模式，请使用支持 WebTransport 的浏览器和 HTTPS 页面' };
  }
  return { available: true };
}

export function createLightningRoom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function certificateOptions(url: string): WebTransportOptions | undefined {
  // A pin is only a development convenience; production always uses normal TLS validation.
  const pin = import.meta.env.VITE_WEBTRANSPORT_CERT_SHA256;
  if (!import.meta.env.DEV || typeof pin !== 'string' || !pin) return undefined;
  const hostname = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname) || !/^[a-fA-F0-9]{64}$/.test(pin)) {
    throw new Error('本地闪电测试证书配置无效');
  }
  return { serverCertificateHashes: [{ algorithm: 'sha-256', value: Uint8Array.from(pin.match(/../g)!, value => parseInt(value, 16)) }] };
}

const bytesOf = (value: Uint8Array | ArrayBuffer) => value instanceof Uint8Array ? value : new Uint8Array(value);

function encodeEnvelope(payload: EncryptedBinaryChatEnvelope): Uint8Array {
  if (!isEncryptedBinaryChatEnvelope(payload)) throw new Error('闪电模式必须使用端到端加密分片');
  const iv = bytesOf(payload.iv), data = bytesOf(payload.data);
  const length = iv.byteLength + data.byteLength;
  if (length > LIGHTNING_MAX_FRAME_BYTES) throw new Error('闪电分片超出大小限制');
  const result = new Uint8Array(4 + length);
  new DataView(result.buffer).setUint32(0, length);
  result.set(iv, 4);
  result.set(data, 16);
  return result;
}

/** One authenticated encrypted-file stream per capability room. Never accepts a peer-supplied URL. */
export async function openLightningChannel({ room, role, signal }: {
  room: string;
  role: 'send' | 'receive';
  signal?: AbortSignal;
}): Promise<LightningChannel> {
  if (!/^[a-f0-9]{64}$/.test(room) || !['send', 'receive'].includes(role)) throw new Error('闪电传输凭据无效');
  const availability = getLightningAvailability();
  if (!availability.available) throw new Error(availability.reason);
  if (signal?.aborted) throw new DOMException('传输已取消', 'AbortError');
  const url = getLightningRelayUrl()!;
  const transport = new WebTransport(url, certificateOptions(url));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let stopped = false, intentional = false, receiving = false, sending = false;
  let pending = new Uint8Array(0);
  let rejectFailure!: (reason: Error) => void;
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  void failure.catch(() => undefined);
  let resolveClosed!: () => void, rejectClosed!: (reason: Error) => void;
  const closed = new Promise<void>((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
  void closed.catch(() => undefined);

  function stop(reason: Error, local = false) {
    if (stopped) return;
    stopped = true;
    intentional = local;
    signal?.removeEventListener('abort', abort);
    rejectFailure(reason);
    if (local) resolveClosed(); else rejectClosed(reason);
    transport.close();
    if (reader) {
      const current = reader;
      void current.cancel().catch(() => undefined).finally(() => current.releaseLock());
    }
    if (writer) {
      const current = writer;
      void current.abort().catch(() => undefined).finally(() => current.releaseLock());
    }
    pending = new Uint8Array(0);
  }
  const abort = () => stop(new DOMException('传输已取消', 'AbortError'));
  signal?.addEventListener('abort', abort, { once: true });
  void transport.closed.then(() => stop(new Error(FAILURE_MESSAGE)), () => stop(new Error(FAILURE_MESSAGE)));

  async function bounded<T>(promise: Promise<T>, timeout = IO_TIMEOUT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, failure, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { const error = new Error('闪电通道等待超时，请重新发送或选择其他模式'); stop(error); reject(error); }, timeout);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function readExact(length: number): Promise<Uint8Array> {
    const output = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      if (!pending.byteLength) {
        const next = await bounded(reader!.read());
        if (next.done) throw new Error('闪电数据流提前结束');
        // Bound a pathological read without concatenating or retaining the entire file.
        if (!(next.value instanceof Uint8Array) || next.value.byteLength > 4 * 1024 * 1024) throw new Error('闪电数据流格式异常');
        pending = next.value;
      }
      const count = Math.min(length - offset, pending.byteLength);
      output.set(pending.subarray(0, count), offset);
      pending = pending.subarray(count);
      offset += count;
    }
    return output;
  }

  try {
    await bounded(transport.ready, CONNECT_TIMEOUT_MS);
    const stream = await bounded(transport.createBidirectionalStream(), CONNECT_TIMEOUT_MS);
    reader = stream.readable.getReader();
    writer = stream.writable.getWriter();
    const hello = new TextEncoder().encode(JSON.stringify({ version: 1, room, role }));
    const handshake = new Uint8Array(4 + hello.byteLength);
    new DataView(handshake.buffer).setUint32(0, hello.byteLength);
    handshake.set(hello, 4);
    await bounded(writer.write(handshake), CONNECT_TIMEOUT_MS);
    if ((await bounded(readExact(1), CONNECT_TIMEOUT_MS))[0] !== 82) throw new Error('闪电中转服务拒绝了连接');
  } catch (error) {
    stop(error instanceof Error ? error : new Error(FAILURE_MESSAGE));
    throw error;
  }

  return {
    closed,
    close: () => stop(new DOMException('传输已关闭', 'AbortError'), true),
    async send(payload) {
      if (stopped || role !== 'send' || sending) throw new Error('闪电发送通道不可用');
      sending = true;
      try { await bounded(writer!.write(encodeEnvelope(payload))); }
      catch (error) { stop(error instanceof Error ? error : new Error(FAILURE_MESSAGE)); throw error; }
      finally { sending = false; }
    },
    async receive(onPayload) {
      if (stopped || role !== 'receive' || receiving) throw new Error('闪电接收通道不可用');
      receiving = true;
      try {
        while (!stopped) {
          const length = new DataView((await readExact(4)).buffer).getUint32(0);
          if (length <= 28 || length > LIGHTNING_MAX_FRAME_BYTES) throw new Error('闪电分片长度无效');
          const body = await readExact(length);
          await onPayload({ type: 'CHAT_CIPHER_BINARY', version: 1, iv: body.subarray(0, 12), data: body.subarray(12) });
        }
      } catch (error) {
        if (intentional) return;
        stop(error instanceof Error ? error : new Error(FAILURE_MESSAGE));
        throw error;
      }
    },
  };
}
