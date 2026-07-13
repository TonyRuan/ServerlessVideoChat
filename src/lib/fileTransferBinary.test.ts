import { describe, expect, it } from 'vitest';
import {
  decodeFileChunkFrame,
  encodeFileChunkFrame,
  type BinaryFileChunkFrame,
} from './fileTransferBinary';

const CHUNK_BYTES = 256 * 1024;
const HEADER_LENGTH_BYTES = 4;

function makeFrame(
  overrides: Partial<BinaryFileChunkFrame> = {},
): BinaryFileChunkFrame {
  return {
    transferId: 'transfer-123',
    from: 'peer-abc',
    index: 0,
    offset: 0,
    data: new Uint8Array([0, 1, 2, 127, 128, 254, 255]),
    ...overrides,
  };
}

function replaceMetadata(
  encoded: Uint8Array,
  update: (metadata: Record<string, unknown>) => void,
): Uint8Array {
  const view = new DataView(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength,
  );
  const headerLength = view.getUint32(0, false);
  const headerEnd = HEADER_LENGTH_BYTES + headerLength;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const metadata = JSON.parse(
    decoder.decode(encoded.subarray(HEADER_LENGTH_BYTES, headerEnd)),
  ) as Record<string, unknown>;
  update(metadata);

  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const result = new Uint8Array(
    HEADER_LENGTH_BYTES + header.byteLength + encoded.byteLength - headerEnd,
  );
  new DataView(result.buffer).setUint32(0, header.byteLength, false);
  result.set(header, HEADER_LENGTH_BYTES);
  result.set(encoded.subarray(headerEnd), HEADER_LENGTH_BYTES + header.byteLength);
  return result;
}

describe('fileTransferBinary', () => {
  it('round trips a full 256 KiB chunk without changing file bytes', () => {
    const data = Uint8Array.from(
      { length: CHUNK_BYTES },
      (_, index) => index % 251,
    );
    const frame = makeFrame({
      index: 3,
      offset: 3 * CHUNK_BYTES,
      data,
    });

    const decoded = decodeFileChunkFrame(encodeFileChunkFrame(frame));

    expect(decoded).toEqual(frame);
    expect(decoded.data).toBeInstanceOf(Uint8Array);
    expect(decoded.data).toEqual(data);
  });

  it('round trips a short final chunk at its fixed 256 KiB offset', () => {
    const frame = makeFrame({
      index: 7,
      offset: 7 * CHUNK_BYTES,
      data: new Uint8Array([255, 0, 128, 64, 1]),
    });

    expect(decodeFileChunkFrame(encodeFileChunkFrame(frame))).toEqual(frame);
  });

  it.each([
    ['empty transferId', makeFrame({ transferId: '' })],
    ['blank from', makeFrame({ from: '   ' })],
    ['negative index', makeFrame({ index: -1 })],
    ['negative offset', makeFrame({ offset: -1 })],
    [
      'unsafe index',
      makeFrame({ index: Number.MAX_SAFE_INTEGER + 1 }),
    ],
    [
      'unsafe offset',
      makeFrame({ offset: Number.MAX_SAFE_INTEGER + 1 }),
    ],
    ['fractional index', makeFrame({ index: 0.5 })],
    ['fractional offset', makeFrame({ offset: 0.5 })],
    ['inconsistent offset', makeFrame({ index: 2, offset: CHUNK_BYTES })],
    ['empty data', makeFrame({ data: new Uint8Array() })],
  ])('rejects %s while encoding', (_label, frame) => {
    expect(() => encodeFileChunkFrame(frame)).toThrow();
  });

  it('rejects data larger than 256 KiB while encoding', () => {
    const frame = makeFrame({ data: new Uint8Array(CHUNK_BYTES + 1) });

    expect(() => encodeFileChunkFrame(frame)).toThrow(/256 KiB|262144/i);
  });

  it('rejects a frame above a custom decoding limit', () => {
    const encoded = encodeFileChunkFrame(
      makeFrame({ data: new Uint8Array([1, 2, 3, 4]) }),
    );

    expect(() =>
      decodeFileChunkFrame(encoded, { maxChunkBytes: 3 }),
    ).toThrow(/3/);
  });

  it('rejects non-Uint8Array input', () => {
    expect(() => decodeFileChunkFrame(new ArrayBuffer(16))).toThrow(
      /Uint8Array/,
    );
  });

  it('rejects truncated and forged header lengths', () => {
    const encoded = encodeFileChunkFrame(makeFrame());
    const truncatedPrefix = encoded.slice(0, HEADER_LENGTH_BYTES - 1);
    const forged = encoded.slice();
    new DataView(forged.buffer).setUint32(0, forged.byteLength, false);

    expect(() => decodeFileChunkFrame(truncatedPrefix)).toThrow();
    expect(() => decodeFileChunkFrame(forged)).toThrow(/header/i);
  });

  it('rejects a truncated payload and unexpected trailing bytes', () => {
    const encoded = encodeFileChunkFrame(makeFrame());
    const truncated = encoded.slice(0, -1);
    const extended = new Uint8Array(encoded.byteLength + 1);
    extended.set(encoded);
    extended[extended.length - 1] = 42;

    expect(() => decodeFileChunkFrame(truncated)).toThrow(/length/i);
    expect(() => decodeFileChunkFrame(extended)).toThrow(/length/i);
  });

  it.each([
    ['wrong type', (metadata: Record<string, unknown>) => {
      metadata.type = 'CHAT_MESSAGE';
    }],
    ['wrong version', (metadata: Record<string, unknown>) => {
      metadata.version = 2;
    }],
  ])('rejects %s metadata', (_label, update) => {
    const encoded = replaceMetadata(encodeFileChunkFrame(makeFrame()), update);

    expect(() => decodeFileChunkFrame(encoded)).toThrow(/type|version/i);
  });

  it('rejects malformed metadata and a forged data length', () => {
    const encoded = encodeFileChunkFrame(makeFrame());
    const malformed = encoded.slice();
    malformed[HEADER_LENGTH_BYTES] = '!'.charCodeAt(0);
    const forgedLength = replaceMetadata(encoded, (metadata) => {
      metadata.dataLength = 1;
    });

    expect(() => decodeFileChunkFrame(malformed)).toThrow(/metadata|JSON/i);
    expect(() => decodeFileChunkFrame(forgedLength)).toThrow(/length/i);
  });
});
