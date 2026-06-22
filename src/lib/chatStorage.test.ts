import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_DATA_URL_CHARS,
  makeConversationId,
  saveChatDraft,
  saveChatMessages,
  trimMessagesForStorage,
  type ChatMessage,
} from './chatStorage';

const makeMessage = (id: string, createdAt: number): ChatMessage => ({
  id,
  conversationId: 'a:b',
  direction: 'out',
  kind: 'text',
  text: `message ${id}`,
  createdAt,
  status: 'sent',
});

describe('chatStorage', () => {
  it('creates a stable conversation id independent of peer order', () => {
    expect(makeConversationId('peer-b', 'peer-a')).toBe('peer-a:peer-b');
    expect(makeConversationId('peer-a', 'peer-b')).toBe('peer-a:peer-b');
  });

  it('keeps the newest messages when trimming local history', () => {
    const messages = Array.from({ length: MAX_CHAT_MESSAGES + 5 }, (_, index) =>
      makeMessage(`m-${index}`, index)
    );

    const trimmed = trimMessagesForStorage(messages);

    expect(trimmed).toHaveLength(MAX_CHAT_MESSAGES);
    expect(trimmed[0].id).toBe('m-5');
    expect(trimmed[trimmed.length - 1].id).toBe(`m-${MAX_CHAT_MESSAGES + 4}`);
  });

  it('drops oldest image-heavy messages until the serialized history fits storage budget', () => {
    const largeData = `data:image/png;base64,${'a'.repeat(700_000)}`;
    const messages: ChatMessage[] = [
      {
        ...makeMessage('image-1', 1),
        kind: 'image',
        image: {
          dataUrl: largeData,
          mimeType: 'image/png',
          name: 'large-1.png',
          size: largeData.length,
        },
      },
      {
        ...makeMessage('image-2', 2),
        kind: 'image',
        image: {
          dataUrl: largeData,
          mimeType: 'image/png',
          name: 'large-2.png',
          size: largeData.length,
        },
      },
      makeMessage('text-final', 3),
    ];

    const trimmed = trimMessagesForStorage(messages);

    expect(trimmed.at(-1)?.id).toBe('text-final');
    expect(JSON.stringify({ version: 1, messages: trimmed }).length).toBeLessThanOrEqual(1_000_000);
  });

  it('keeps one allowed image message within the local history budget', () => {
    const allowedData = `data:image/png;base64,${'a'.repeat(MAX_CHAT_IMAGE_DATA_URL_CHARS - 22)}`;
    const messages: ChatMessage[] = [
      {
        ...makeMessage('image-ok', 1),
        kind: 'image',
        image: {
          dataUrl: allowedData,
          mimeType: 'image/png',
          name: 'ok.png',
          size: MAX_CHAT_IMAGE_BYTES,
        },
      },
    ];

    const trimmed = trimMessagesForStorage(messages);

    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].id).toBe('image-ok');
    expect(JSON.stringify({ version: 1, messages: trimmed }).length).toBeLessThanOrEqual(1_000_000);
  });

  it('does not throw when localStorage refuses history or draft writes', () => {
    const originalLocalStorage = globalThis.localStorage;
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    Object.defineProperty(globalThis, 'localStorage', {
      value: throwingStorage,
      configurable: true,
    });

    expect(() => saveChatMessages('a:b', [makeMessage('m-1', 1)])).not.toThrow();
    expect(() => saveChatDraft('a:b', 'hello')).not.toThrow();
    expect(() => saveChatDraft('a:b', '')).not.toThrow();

    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });
});
