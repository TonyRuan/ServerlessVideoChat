import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_ATTACHMENT_NAME_CHARS,
  MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_DATA_URL_CHARS,
  MAX_CHAT_STORAGE_CHARS,
  loadChatMessages,
  makeConversationId,
  purgePersistedChatStorage,
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

  it('allows 2GiB source files while keeping the memory fallback capped', () => {
    expect(MAX_CHAT_FILE_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(MAX_CHAT_MEMORY_FILE_FALLBACK_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_CHAT_ATTACHMENT_NAME_CHARS).toBe(255);
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

  it('does not persist chat history or drafts to localStorage', () => {
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

    saveChatMessages(conversationId, [makeMessage('m-1', 1)]);
    saveChatDraft(conversationId, 'hello');

    const loaded = loadChatMessages(conversationId);

    expect(loaded).toEqual([]);
    expect(entries.size).toBe(0);

    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it('purges legacy persisted chat history and drafts without touching unrelated keys', () => {
    const originalLocalStorage = globalThis.localStorage;
    const entries = new Map<string, string>([
      ['serverlessVideoChat:chat:v1:a:b', 'history'],
      ['serverlessVideoChat:chatDraft:v1:a:b', 'draft'],
      ['serverlessVideoChat:chatPanelPosition:v1', 'position'],
      ['theme', 'dark'],
    ]);
    const storage = {
      length: entries.size,
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    } as unknown as Storage;

    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
    });

    purgePersistedChatStorage();

    expect(entries.has('serverlessVideoChat:chat:v1:a:b')).toBe(false);
    expect(entries.has('serverlessVideoChat:chatDraft:v1:a:b')).toBe(false);
    expect(entries.get('serverlessVideoChat:chatPanelPosition:v1')).toBe('position');
    expect(entries.get('theme')).toBe('dark');

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
