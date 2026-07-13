import { describe, expect, it } from 'vitest';
import {
  createChatCryptoSession,
  isEncryptedBinaryChatEnvelope,
  isEncryptedChatEnvelope,
} from './chatCrypto';

describe('chatCrypto', () => {
  it('encrypts a payload for another session and decrypts it back', async () => {
    const alice = await createChatCryptoSession();
    const bob = await createChatCryptoSession();

    await alice.acceptPeerPublicKey(bob.publicKey);
    await bob.acceptPeerPublicKey(alice.publicKey);

    const envelope = await alice.encrypt({
      type: 'CHAT_MESSAGE',
      message: {
        id: 'message-1',
        from: 'alice',
        kind: 'mixed',
        text: 'hello',
        image: {
          dataUrl: 'data:image/png;base64,abc',
          mimeType: 'image/png',
          name: 'a.png',
          size: 3,
        },
        createdAt: 123,
      },
    });

    expect(isEncryptedChatEnvelope(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('hello');

    const decrypted = await bob.decrypt(envelope);

    expect(decrypted).toEqual({
      type: 'CHAT_MESSAGE',
      message: {
        id: 'message-1',
        from: 'alice',
        kind: 'mixed',
        text: 'hello',
        image: {
          dataUrl: 'data:image/png;base64,abc',
          mimeType: 'image/png',
          name: 'a.png',
          size: 3,
        },
        createdAt: 123,
      },
    });
  });

  it('refuses to encrypt until a peer key has been accepted', async () => {
    const alice = await createChatCryptoSession();

    await expect(alice.encrypt({ type: 'CHAT_MESSAGE', message: { id: 'x' } })).rejects.toThrow(
      'Chat encryption key is not ready'
    );
  });

  it('encrypts raw bytes without base64 and decrypts them losslessly', async () => {
    const alice = await createChatCryptoSession();
    const bob = await createChatCryptoSession();

    await alice.acceptPeerPublicKey(bob.publicKey);
    await bob.acceptPeerPublicKey(alice.publicKey);

    const plaintext = new Uint8Array(256 * 1024);
    plaintext.forEach((_, index) => {
      plaintext[index] = index % 251;
    });

    const envelope = await alice.encryptBytes(plaintext);

    expect(isEncryptedBinaryChatEnvelope(envelope)).toBe(true);
    expect(envelope.iv).toBeInstanceOf(Uint8Array);
    expect(envelope.data).toBeInstanceOf(Uint8Array);
    expect(envelope.data).not.toEqual(plaintext);
    await expect(bob.decryptBytes(envelope)).resolves.toEqual(plaintext);

    const peerJsDecodedEnvelope = {
      ...envelope,
      iv: envelope.iv instanceof Uint8Array ? envelope.iv.slice().buffer : envelope.iv.slice(0),
      data: envelope.data instanceof Uint8Array ? envelope.data.slice().buffer : envelope.data.slice(0),
    };
    expect(isEncryptedBinaryChatEnvelope(peerJsDecodedEnvelope)).toBe(true);
    await expect(bob.decryptBytes(peerJsDecodedEnvelope)).resolves.toEqual(plaintext);
  });
});
