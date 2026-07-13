export interface BinaryFileChunkFrame {
  transferId: string;
  from: string;
  index: number;
  offset: number;
  data: Uint8Array;
}

const FILE_CHUNK_FRAME_TYPE = 'SVC_FILE_CHUNK';
const FILE_CHUNK_FRAME_VERSION = 1;
const FILE_CHUNK_BYTES = 256 * 1024;
const HEADER_LENGTH_BYTES = 4;
const MAX_HEADER_BYTES = 64 * 1024;

interface FileChunkMetadata {
  type: typeof FILE_CHUNK_FRAME_TYPE;
  version: typeof FILE_CHUNK_FRAME_VERSION;
  transferId: string;
  from: string;
  index: number;
  offset: number;
  dataLength: number;
}

interface UntrustedFileChunkFrame {
  transferId: unknown;
  from: unknown;
  index: unknown;
  offset: unknown;
  data: unknown;
}

function assertNonEmptyString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function assertSafeNonNegativeInteger(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
}

function assertValidOffset(index: number, offset: number): void {
  const expectedOffset = index * FILE_CHUNK_BYTES;
  if (!Number.isSafeInteger(expectedOffset) || offset !== expectedOffset) {
    throw new Error(
      `offset must equal index * ${FILE_CHUNK_BYTES} bytes`,
    );
  }
}

function assertMaxChunkBytes(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error('maxChunkBytes must be a positive safe integer');
  }
}

function assertChunkData(
  value: unknown,
  maxChunkBytes: number,
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error('data must be a Uint8Array');
  }
  if (value.byteLength === 0) {
    throw new Error('data must not be empty');
  }
  if (value.byteLength > maxChunkBytes) {
    throw new Error(`data exceeds the ${maxChunkBytes} byte (256 KiB) limit`);
  }
}

function assertFrameFields(
  frame: UntrustedFileChunkFrame,
  maxChunkBytes: number,
): asserts frame is BinaryFileChunkFrame {
  assertNonEmptyString(frame.transferId, 'transferId');
  assertNonEmptyString(frame.from, 'from');
  assertSafeNonNegativeInteger(frame.index, 'index');
  assertSafeNonNegativeInteger(frame.offset, 'offset');
  assertValidOffset(frame.index, frame.offset);
  assertChunkData(frame.data, maxChunkBytes);
}

function parseMetadata(header: Uint8Array): Record<string, unknown> {
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(header);
  } catch {
    throw new Error('File chunk metadata is not valid UTF-8');
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('File chunk metadata is not valid JSON');
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('File chunk metadata must be an object');
  }
  return value as Record<string, unknown>;
}

export function encodeFileChunkFrame(
  frame: BinaryFileChunkFrame,
): Uint8Array {
  if (frame === null || typeof frame !== 'object') {
    throw new Error('File chunk frame must be an object');
  }
  assertFrameFields(frame, FILE_CHUNK_BYTES);

  const metadata: FileChunkMetadata = {
    type: FILE_CHUNK_FRAME_TYPE,
    version: FILE_CHUNK_FRAME_VERSION,
    transferId: frame.transferId,
    from: frame.from,
    index: frame.index,
    offset: frame.offset,
    dataLength: frame.data.byteLength,
  };
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  if (header.byteLength === 0 || header.byteLength > MAX_HEADER_BYTES) {
    throw new Error('File chunk metadata header is too large');
  }

  const encoded = new Uint8Array(
    HEADER_LENGTH_BYTES + header.byteLength + frame.data.byteLength,
  );
  new DataView(encoded.buffer).setUint32(0, header.byteLength, false);
  encoded.set(header, HEADER_LENGTH_BYTES);
  encoded.set(frame.data, HEADER_LENGTH_BYTES + header.byteLength);
  return encoded;
}

export function decodeFileChunkFrame(
  value: unknown,
  options: { maxChunkBytes?: number } = {},
): BinaryFileChunkFrame {
  if (!(value instanceof Uint8Array)) {
    throw new Error('File chunk frame must be a Uint8Array');
  }
  if (value.byteLength < HEADER_LENGTH_BYTES) {
    throw new Error('File chunk frame is missing its header length');
  }

  const maxChunkBytes = options.maxChunkBytes ?? FILE_CHUNK_BYTES;
  assertMaxChunkBytes(maxChunkBytes);

  const headerLength = new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  ).getUint32(0, false);
  const headerEnd = HEADER_LENGTH_BYTES + headerLength;
  if (
    headerLength === 0 ||
    headerLength > MAX_HEADER_BYTES ||
    headerEnd > value.byteLength
  ) {
    throw new Error('Invalid file chunk header length');
  }

  const metadata = parseMetadata(
    value.subarray(HEADER_LENGTH_BYTES, headerEnd),
  );
  if (metadata.type !== FILE_CHUNK_FRAME_TYPE) {
    throw new Error('Invalid file chunk frame type');
  }
  if (metadata.version !== FILE_CHUNK_FRAME_VERSION) {
    throw new Error('Unsupported file chunk frame version');
  }

  assertSafeNonNegativeInteger(metadata.dataLength, 'dataLength');
  const data = value.subarray(headerEnd);
  if (metadata.dataLength !== data.byteLength) {
    throw new Error('File chunk data length does not match its metadata');
  }

  const frame = {
    transferId: metadata.transferId,
    from: metadata.from,
    index: metadata.index,
    offset: metadata.offset,
    data,
  };
  assertFrameFields(frame, maxChunkBytes);
  return frame;
}
