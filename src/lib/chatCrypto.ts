import { base64ToBytes, bytesToBase64 } from './base64';

export interface ChatCryptoKeyMessage {
  type: 'CHAT_CRYPTO_KEY';
  version: 1;
  publicKey: JsonWebKey;
}

export interface EncryptedChatEnvelope {
  type: 'CHAT_CIPHER';
  version: 1;
  iv: string;
  data: string;
}

export interface EncryptedBinaryChatEnvelope {
  type: 'CHAT_CIPHER_BINARY';
  version: 1;
  iv: Uint8Array | ArrayBuffer;
  data: Uint8Array | ArrayBuffer;
}

export interface ChatCryptoSession {
  publicKey: JsonWebKey;
  isReady: () => boolean;
  acceptPeerPublicKey: (publicKey: JsonWebKey) => Promise<void>;
  encrypt: (payload: unknown) => Promise<EncryptedChatEnvelope>;
  decrypt: (envelope: EncryptedChatEnvelope) => Promise<unknown>;
  encryptBytes: (payload: Uint8Array) => Promise<EncryptedBinaryChatEnvelope>;
  decryptBytes: (envelope: EncryptedBinaryChatEnvelope) => Promise<Uint8Array>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const binaryByteLength = (value: unknown) =>
  value instanceof Uint8Array || value instanceof ArrayBuffer ? value.byteLength : null;

const toUint8Array = (value: Uint8Array | ArrayBuffer) =>
  value instanceof Uint8Array ? value : new Uint8Array(value);

export function isChatCryptoKeyMessage(data: unknown): data is ChatCryptoKeyMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === 'CHAT_CRYPTO_KEY' &&
    (data as Record<string, unknown>).version === 1 &&
    typeof (data as Record<string, unknown>).publicKey === 'object'
  );
}

export function isEncryptedChatEnvelope(data: unknown): data is EncryptedChatEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === 'CHAT_CIPHER' &&
    (data as Record<string, unknown>).version === 1 &&
    typeof (data as Record<string, unknown>).iv === 'string' &&
    typeof (data as Record<string, unknown>).data === 'string'
  );
}

export function isEncryptedBinaryChatEnvelope(data: unknown): data is EncryptedBinaryChatEnvelope {
  if (typeof data !== 'object' || data === null) return false;

  const record = data as Record<string, unknown>;
  return (
    record.type === 'CHAT_CIPHER_BINARY' &&
    record.version === 1 &&
    binaryByteLength(record.iv) === 12 &&
    (binaryByteLength(record.data) ?? 0) > 16
  );
}

export async function createChatCryptoSession(): Promise<ChatCryptoSession> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  let sharedKey: CryptoKey | null = null;

  const requireSharedKey = () => {
    if (!sharedKey) {
      throw new Error('Chat encryption key is not ready');
    }
    return sharedKey;
  };

  return {
    publicKey,
    isReady: () => Boolean(sharedKey),
    acceptPeerPublicKey: async (peerPublicKey) => {
      const importedPeerKey = await crypto.subtle.importKey(
        'jwk',
        peerPublicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );

      sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: importedPeerKey },
        keyPair.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    },
    encrypt: async (payload) => {
      const key = requireSharedKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = encoder.encode(JSON.stringify(payload));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

      return {
        type: 'CHAT_CIPHER',
        version: 1,
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(ciphertext)),
      };
    },
    decrypt: async (envelope) => {
      const key = requireSharedKey();
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
        key,
        base64ToBytes(envelope.data)
      );
      return JSON.parse(decoder.decode(plaintext));
    },
    encryptBytes: async (payload) => {
      const key = requireSharedKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);

      return {
        type: 'CHAT_CIPHER_BINARY',
        version: 1,
        iv,
        data: new Uint8Array(ciphertext),
      };
    },
    decryptBytes: async (envelope) => {
      const key = requireSharedKey();
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toUint8Array(envelope.iv) },
        key,
        toUint8Array(envelope.data)
      );
      return new Uint8Array(plaintext);
    },
  };
}
