import { base64ToBytes, bytesToBase64 } from './base64';

export interface ChatCryptoKeyMessage {
  type: 'CHAT_CRYPTO_KEY';
  version: 1;
  publicKey: JsonWebKey;
}

export interface AuthenticatedChatCryptoKeyMessage {
  type: 'CHAT_CRYPTO_KEY';
  version: 2;
  context: string;
  peerId: string;
  publicKey: JsonWebKey;
  proof: string;
}

export type AnyChatCryptoKeyMessage = ChatCryptoKeyMessage | AuthenticatedChatCryptoKeyMessage;

export interface ChatCryptoAuthentication {
  context: string;
  localPeerId: string;
  remotePeerId: string;
  sharedSecret: string;
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
  keyMessage: AnyChatCryptoKeyMessage;
  isReady: () => boolean;
  acceptPeerPublicKey: (publicKey: JsonWebKey) => Promise<void>;
  acceptPeerKeyMessage: (message: AnyChatCryptoKeyMessage) => Promise<void>;
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

export function isChatCryptoKeyMessage(data: unknown): data is AnyChatCryptoKeyMessage {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  if (record.type !== 'CHAT_CRYPTO_KEY' || typeof record.publicKey !== 'object' || record.publicKey === null) {
    return false;
  }
  if (record.version === 1) return true;
  return (
    record.version === 2 &&
    typeof record.context === 'string' && record.context.length >= 3 && record.context.length <= 128 &&
    typeof record.peerId === 'string' && record.peerId.length >= 3 && record.peerId.length <= 128 &&
    typeof record.proof === 'string' && record.proof.length > 0 && record.proof.length <= 256
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

const canonicalPublicKey = (publicKey: JsonWebKey) => JSON.stringify({
  crv: publicKey.crv,
  kty: publicKey.kty,
  x: publicKey.x,
  y: publicKey.y,
});

const createAuthenticationProof = async (
  authentication: ChatCryptoAuthentication,
  peerId: string,
  publicKey: JsonWebKey
) => {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authentication.sharedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const body = encoder.encode(
    `svc-chat-key-v2|${authentication.context}|${peerId}|${canonicalPublicKey(publicKey)}`
  );
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, body)));
};

const verifyAuthenticationProof = async (
  authentication: ChatCryptoAuthentication,
  message: AuthenticatedChatCryptoKeyMessage
) => {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authentication.sharedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const body = encoder.encode(
    `svc-chat-key-v2|${message.context}|${message.peerId}|${canonicalPublicKey(message.publicKey)}`
  );
  return crypto.subtle.verify('HMAC', hmacKey, base64ToBytes(message.proof), body);
};

export async function createChatCryptoSession(
  authentication?: ChatCryptoAuthentication
): Promise<ChatCryptoSession> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const keyMessage: AnyChatCryptoKeyMessage = authentication
    ? {
        type: 'CHAT_CRYPTO_KEY',
        version: 2,
        context: authentication.context,
        peerId: authentication.localPeerId,
        publicKey,
        proof: await createAuthenticationProof(authentication, authentication.localPeerId, publicKey),
      }
    : {
        type: 'CHAT_CRYPTO_KEY',
        version: 1,
        publicKey,
      };
  let sharedKey: CryptoKey | null = null;

  const requireSharedKey = () => {
    if (!sharedKey) {
      throw new Error('Chat encryption key is not ready');
    }
    return sharedKey;
  };

  const acceptPeerPublicKey = async (peerPublicKey: JsonWebKey) => {
    const importedPeerKey = await crypto.subtle.importKey(
      'jwk',
      peerPublicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    if (!authentication) {
      sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: importedPeerKey },
        keyPair.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      return;
    }

    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: importedPeerKey },
      keyPair.privateKey,
      256
    );
    const material = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const peerIds = [authentication.localPeerId, authentication.remotePeerId].sort().join('|');
    sharedKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode(authentication.sharedSecret),
        info: encoder.encode(`svc-device-session-v1|${authentication.context}|${peerIds}`),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  };

  const acceptPeerKeyMessage = async (message: AnyChatCryptoKeyMessage) => {
    if (!authentication) {
      if (message.version !== 1) throw new Error('Unexpected authenticated chat key');
      await acceptPeerPublicKey(message.publicKey);
      return;
    }

    if (
      message.version !== 2 ||
      message.context !== authentication.context ||
      message.peerId !== authentication.remotePeerId ||
      !await verifyAuthenticationProof(authentication, message)
    ) {
      throw new Error('Device pairing authentication failed');
    }
    await acceptPeerPublicKey(message.publicKey);
  };

  return {
    publicKey,
    keyMessage,
    isReady: () => Boolean(sharedKey),
    acceptPeerPublicKey,
    acceptPeerKeyMessage,
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
