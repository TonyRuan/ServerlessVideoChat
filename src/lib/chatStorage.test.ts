import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_DATA_URL_CHARS,
  MAX_CHAT_STORAGE_CHARS,
  loadChatMessages,
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
  it('allows 10MiB source images and enough base64 data URL space', () => {
    expect(MAX_CHAT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_CHAT_IMAGE_DATA_URL_CHARS).toBeGreaterThan(Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4);
  });

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
    expect(JSON.stringify({ version: 1, messages: trimmed }).length).toBeLessThanOrEqual(MAX_CHAT_STORAGE_CHARS);
  });

  it('keeps one small image message within the local history budget', () => {
    const allowedData = `data:image/gif;base64,${'a'.repeat(1024)}`;
    const messages: ChatMessage[] = [
      {
        ...makeMessage('image-ok', 1),
        kind: 'image',
        image: {
          dataUrl: allowedData,
          mimeType: 'image/gif',
          name: 'ok.gif',
          size: 768,
        },
      },
    ];

    const trimmed = trimMessagesForStorage(messages);

    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].id).toBe('image-ok');
    expect(JSON.stringify({ version: 1, messages: trimmed }).length).toBeLessThanOrEqual(MAX_CHAT_STORAGE_CHARS);
  });

  it('persists an oversized local image history entry without the data URL payload', () => {
    const conversationId = 'a:b';
    const originalLocalStorage = globalThis.localStorage;
    const entries = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    } as unknown as Storage;

    Object.defineProperty(globalThis, 'localStorage', {
      value: memoryStorage,
      configurable: true,
    });

    saveChatMessages(conversationId, [
      {
        ...makeMessage('large-gif', 1),
        kind: 'image',
        image: {
          dataUrl: `data:image/gif;base64,${'a'.repeat(MAX_CHAT_STORAGE_CHARS + 1)}`,
          mimeType: 'image/gif',
          name: 'large.gif',
          size: MAX_CHAT_IMAGE_BYTES,
        },
      },
      makeMessage('text-final', 2),
    ]);

    const loaded = loadChatMessages(conversationId);

    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe('large-gif');
    expect(loaded[0].image?.dataUrl).toBe('');
    expect(loaded[0].image?.name).toBe('large.gif');
    expect(loaded[1].id).toBe('text-final');

    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
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
