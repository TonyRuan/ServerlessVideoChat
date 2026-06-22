import { describe, expect, it } from 'vitest';
import { createWireChatMessage, isWireChatPayload } from './chatProtocol';
import { MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_DATA_URL_CHARS, type ChatMessage } from './chatStorage';

const localMessage: ChatMessage = {
  id: 'message-1',
  conversationId: 'a:b',
  direction: 'out',
  kind: 'mixed',
  text: 'hello',
  image: {
    dataUrl: 'data:image/png;base64,abc',
    mimeType: 'image/png',
    name: 'a.png',
    size: 3,
  },
  createdAt: 123,
  status: 'sending',
};

describe('chatProtocol', () => {
  it('creates a wire chat payload without local-only fields', () => {
    const payload = createWireChatMessage(localMessage, 'peer-a');

    expect(payload).toEqual({
      type: 'CHAT_MESSAGE',
      message: {
        id: 'message-1',
        from: 'peer-a',
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

  it('rejects malformed wire chat payloads', () => {
    expect(isWireChatPayload({ type: 'CHAT_MESSAGE', message: { id: 'x' } })).toBe(false);
    expect(isWireChatPayload({ type: 'CHAT_MESSAGE', message: { id: 'x', from: 'p', kind: 'text', createdAt: 1 } })).toBe(false);
    expect(
      isWireChatPayload({
        type: 'CHAT_MESSAGE',
        message: {
          id: 'x',
          from: 'p',
          kind: 'image',
          createdAt: 1,
          image: { dataUrl: 'data:text/plain,abc', mimeType: 'text/plain', name: 'x.txt', size: 3 },
        },
      })
    ).toBe(false);
  });

  it('rejects image payloads over the accepted chat limits', () => {
    const oversizedImage = {
      type: 'CHAT_MESSAGE',
      message: {
        id: 'x',
        from: 'p',
        kind: 'image',
        createdAt: 1,
        image: {
          dataUrl: 'data:image/png;base64,abc',
          mimeType: 'image/png',
          name: 'too-large.png',
          size: MAX_CHAT_IMAGE_BYTES + 1,
        },
      },
    };

    const oversizedDataUrl = {
      type: 'CHAT_MESSAGE',
      message: {
        id: 'x',
        from: 'p',
        kind: 'image',
        createdAt: 1,
        image: {
          dataUrl: `data:image/png;base64,${'a'.repeat(MAX_CHAT_IMAGE_DATA_URL_CHARS)}`,
          mimeType: 'image/png',
          name: 'too-long.png',
          size: 10,
        },
      },
    };

    expect(isWireChatPayload(oversizedImage)).toBe(false);
    expect(isWireChatPayload(oversizedDataUrl)).toBe(false);
  });
});
