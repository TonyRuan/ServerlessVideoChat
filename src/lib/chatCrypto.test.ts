import { describe, expect, it } from 'vitest';
import { createChatCryptoSession, isEncryptedChatEnvelope } from './chatCrypto';

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
});
