import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import type { EncryptedBinaryChatEnvelope } from './chatCrypto';
import { createLightningRoom, getLightningAvailability, getLightningRelayUrl, LIGHTNING_MAX_FRAME_BYTES, openLightningChannel } from './webTransportFile';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false), getPlatform: vi.fn(() => 'web') } }));
const room = 'a'.repeat(64);
const ciphertext: EncryptedBinaryChatEnvelope = { type: 'CHAT_CIPHER_BINARY', version: 1, iv: new Uint8Array(12).fill(3), data: new Uint8Array(32).fill(9) };
function wire(payload = ciphertext) {
  const iv = new Uint8Array(payload.iv), data = new Uint8Array(payload.data);
  const output = new Uint8Array(4 + iv.length + data.length);
  new DataView(output.buffer).setUint32(0, iv.length + data.length);
  output.set(iv, 4); output.set(data, 16); return output;
}

class MockTransport {
  static instances: MockTransport[] = [];
  static readyByte = 82;
  static hangReady = false;
  ready = MockTransport.hangReady ? new Promise<void>(() => undefined) : Promise.resolve();
  private resolveClosed!: () => void;
  closed = new Promise<void>(resolve => { this.resolveClosed = resolve; });
  controller!: ReadableStreamDefaultController<Uint8Array>;
  readable = new ReadableStream<Uint8Array>({ start: controller => { this.controller = controller; controller.enqueue(Uint8Array.of(MockTransport.readyByte)); } });
  writes: Uint8Array[] = [];
  writable = new WritableStream<Uint8Array>({ write: data => { this.writes.push(data.slice()); } });
  close = vi.fn(() => this.resolveClosed());
  createBidirectionalStream = vi.fn(async () => ({ readable: this.readable, writable: this.writable }));
  constructor(public url: string, public options?: WebTransportOptions) { MockTransport.instances.push(this); }
}

beforeEach(() => {
  MockTransport.instances = []; MockTransport.readyByte = 82; MockTransport.hangReady = false;
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
  vi.stubEnv('VITE_WEBTRANSPORT_URL', 'https://relay.example/file');
  vi.stubEnv('VITE_WEBTRANSPORT_CERT_SHA256', '');
  vi.stubEnv('DEV', true);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('WebTransport', MockTransport);
});
afterEach(() => { for (const instance of MockTransport.instances) instance.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('lightning availability', () => {
  it('requires configured HTTPS, WebTransport and a secure context', () => {
    expect(getLightningAvailability()).toEqual({ available: true });
    vi.stubGlobal('isSecureContext', false);
    expect(getLightningAvailability().available).toBe(false);
    vi.stubGlobal('isSecureContext', true); vi.stubGlobal('WebTransport', undefined);
    expect(getLightningAvailability().available).toBe(false);
  });
  it('enables Android only when its WebView provides WebTransport and HTTPS', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    vi.stubEnv('DEV', false);
    expect(getLightningAvailability()).toEqual({ available: true });
    const channel = await openLightningChannel({ room, role: 'send' });
    await channel.send(ciphertext);
    expect(MockTransport.instances[0].options).toBeUndefined();
    expect(MockTransport.instances[0].writes[1]).toEqual(wire());
    channel.close();
    vi.stubGlobal('WebTransport', undefined);
    expect(getLightningAvailability()).toEqual({ available: false, reason: expect.stringContaining('Android System WebView') });
    vi.stubGlobal('WebTransport', MockTransport); vi.stubGlobal('isSecureContext', false);
    expect(getLightningAvailability().available).toBe(false);
  });
  it('does not advertise unsupported native platforms', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    expect(getLightningAvailability().available).toBe(false);
  });
  it.each(['', 'http://relay.example/file', 'https://user:pass@relay.example/file', 'https://relay.example/file?room=secret', 'https://relay.example/file#fragment', 'not a url'])('rejects unsafe configured endpoint %s', value => {
    vi.stubEnv('VITE_WEBTRANSPORT_URL', value);
    expect(getLightningRelayUrl()).toBeNull();
    expect(getLightningAvailability().available).toBe(false);
  });
  it('generates unique 256 bit room capabilities', () => {
    const first = createLightningRoom(), second = createLightningRoom();
    expect(first).toMatch(/^[a-f0-9]{64}$/); expect(first).not.toBe(second);
  });
  it('pins only localhost development certificates and ignores pins in production', async () => {
    vi.stubEnv('VITE_WEBTRANSPORT_CERT_SHA256', 'b'.repeat(64));
    await expect(openLightningChannel({ room, role: 'send' })).rejects.toThrow('证书配置');
    expect(MockTransport.instances).toHaveLength(0);
    vi.stubEnv('VITE_WEBTRANSPORT_URL', 'https://127.0.0.1:4433/file');
    const channel = await openLightningChannel({ room, role: 'send' });
    expect(MockTransport.instances[0].options?.serverCertificateHashes?.[0].value).toEqual(new Uint8Array(32).fill(187));
    channel.close();
    vi.stubEnv('DEV', false); vi.stubEnv('VITE_WEBTRANSPORT_URL', 'https://relay.example/file');
    const prod = await openLightningChannel({ room, role: 'send' });
    expect(MockTransport.instances[1].options).toBeUndefined(); prod.close();
  });
});

describe('lightning encrypted stream', () => {
  it('sends capability only inside handshake and frames encrypted binary without base64', async () => {
    const channel = await openLightningChannel({ room, role: 'send' });
    const transport = MockTransport.instances[0];
    expect(transport.url).toBe('https://relay.example/file');
    const hello = transport.writes[0];
    expect(new DataView(hello.buffer).getUint32(0)).toBe(hello.length - 4);
    expect(JSON.parse(new TextDecoder().decode(hello.subarray(4)))).toEqual({ version: 1, room, role: 'send' });
    await channel.send(ciphertext);
    expect(transport.writes[1]).toEqual(wire());
    channel.close(); await expect(channel.closed).resolves.toBeUndefined();
    await expect(channel.send(ciphertext)).rejects.toThrow('不可用');
  });
  it('rejects plaintext and overlarge ciphertext before writing', async () => {
    const channel = await openLightningChannel({ room, role: 'send' });
    await expect(channel.send(new Uint8Array(42) as unknown as EncryptedBinaryChatEnvelope)).rejects.toThrow('端到端加密');
    expect(MockTransport.instances[0].writes).toHaveLength(1);
    const oversized = await openLightningChannel({ room, role: 'send' });
    await expect(oversized.send({ ...ciphertext, data: new Uint8Array(LIGHTNING_MAX_FRAME_BYTES) })).rejects.toThrow('大小限制');
  });
  it('reassembles split headers/bodies and awaits each sink before reading another frame', async () => {
    const channel = await openLightningChannel({ room, role: 'receive' });
    const transport = MockTransport.instances[0];
    const first = wire(), combined = new Uint8Array(first.length * 2); combined.set(first); combined.set(first, first.length);
    let unblock!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    let count = 0;
    const receive = channel.receive(async payload => {
      expect(payload).toEqual(ciphertext); count++;
      if (count === 1) await blocked; else channel.close();
    });
    transport.controller.enqueue(combined.subarray(0, 2)); transport.controller.enqueue(combined.subarray(2, 20)); transport.controller.enqueue(combined.subarray(20));
    await vi.waitFor(() => expect(count).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 10)); expect(count).toBe(1);
    unblock(); await receive; expect(count).toBe(2);
  });
  it.each([0, 28, LIGHTNING_MAX_FRAME_BYTES + 1])('rejects invalid body length %i without allocation', async length => {
    const channel = await openLightningChannel({ room, role: 'receive' });
    const result = channel.receive(async () => { throw Error('must not deliver'); });
    const head = new Uint8Array(4); new DataView(head.buffer).setUint32(0, length);
    MockTransport.instances[0].controller.enqueue(head);
    await expect(result).rejects.toThrow('长度无效');
    await expect(channel.closed).rejects.toThrow('长度无效');
  });
  it('rejects truncated frame and exposes remote session closure', async () => {
    const channel = await openLightningChannel({ room, role: 'receive' });
    const receive = channel.receive(async () => undefined);
    MockTransport.instances[0].controller.enqueue(wire().subarray(0, 8)); MockTransport.instances[0].controller.close();
    await expect(receive).rejects.toThrow('提前结束');
    const remote = await openLightningChannel({ room, role: 'send' });
    MockTransport.instances[1].close(); await expect(remote.closed).rejects.toThrow('断开');
  });
  it('aborts a waiting read and cancels its timers', async () => {
    const controller = new AbortController();
    const channel = await openLightningChannel({ room, role: 'receive', signal: controller.signal });
    const receive = channel.receive(async () => undefined);
    controller.abort();
    await expect(receive).rejects.toMatchObject({ name: 'AbortError' });
    await expect(channel.closed).rejects.toMatchObject({ name: 'AbortError' });
    expect(MockTransport.instances[0].close).toHaveBeenCalled();
  });
  it('bounds connection timeout and closes pending transport', async () => {
    vi.useFakeTimers(); MockTransport.hangReady = true;
    const opening = openLightningChannel({ room, role: 'send' });
    const assertion = expect(opening).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(20_000); await assertion;
    expect(MockTransport.instances[0].close).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects invalid ready byte and invalid room without sending application data', async () => {
    await expect(openLightningChannel({ room: 'short', role: 'send' })).rejects.toThrow('凭据无效');
    MockTransport.readyByte = 0;
    await expect(openLightningChannel({ room, role: 'send' })).rejects.toThrow('拒绝');
    expect(MockTransport.instances[0].writes).toHaveLength(1);
  });
});
