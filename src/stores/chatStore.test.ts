import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MAX_CHAT_MESSAGES } from '../lib/chatStorage';
import { useChatStore } from './chatStore';

const resetChatStore = () => {
  useChatStore.setState({
    conversationId: null,
    peerId: null,
    messages: [],
    draftText: '',
    isPanelOpen: false,
    unreadCount: 0,
  });
};

describe('chatStore', () => {
  beforeEach(() => {
    resetChatStore();
  });

  it('keeps in-memory messages and draft when the peer id changes inside the same call session', () => {
    const { setConversationPeers, createLocalMessage, setDraftText } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer-1', 'session-1');
    const message = createLocalMessage({ myPeerId: 'local-peer', text: 'hello' });
    setDraftText('still typing');

    const originalConversationId = useChatStore.getState().conversationId;

    setConversationPeers('local-peer', 'remote-peer-2', 'session-1');

    expect(useChatStore.getState().conversationId).toBe(originalConversationId);
    expect(useChatStore.getState().peerId).toBe('remote-peer-2');
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe(message?.id);
    expect(useChatStore.getState().draftText).toBe('still typing');
  });

  it('clears in-memory messages and draft when switching to a different call session', () => {
    const { setConversationPeers, createLocalMessage, setDraftText } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer-1', 'session-1');
    createLocalMessage({ myPeerId: 'local-peer', text: 'hello' });
    setDraftText('still typing');

    setConversationPeers('local-peer', 'remote-peer-2', 'session-2');

    expect(useChatStore.getState().peerId).toBe('remote-peer-2');
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().draftText).toBe('');
  });

  it('creates local downloadable file messages in memory', () => {
    const { setConversationPeers, createLocalMessage, setDraftText } = useChatStore.getState();
    const file = {
      dataUrl: 'data:application/pdf;base64,JVBERi0=',
      mimeType: 'application/pdf',
      name: 'brief.pdf',
      size: 7,
    };

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    setDraftText('see attached');
    const message = createLocalMessage({ myPeerId: 'local-peer', text: 'see attached', file });

    expect(message?.kind).toBe('mixed');
    expect(message?.file).toBe(file);
    expect(useChatStore.getState().messages[0].file).toBe(file);
    expect(useChatStore.getState().draftText).toBe('');
  });

  it('adds incoming downloadable file messages without opening the panel', () => {
    const { setConversationPeers, addIncomingWireMessage } = useChatStore.getState();
    const file = {
      dataUrl: 'data:application/zip;base64,UEs=',
      mimeType: 'application/zip',
      name: 'logs.zip',
      size: 3,
    };

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    addIncomingWireMessage({
      type: 'CHAT_MESSAGE',
      message: {
        id: 'file-1',
        from: 'remote-peer',
        kind: 'file',
        file,
        createdAt: 123,
      },
    });

    expect(useChatStore.getState().messages).toMatchObject([
      {
        id: 'file-1',
        direction: 'in',
        kind: 'file',
        file,
        status: 'received',
      },
    ]);
    expect(useChatStore.getState().unreadCount).toBe(1);
  });

  it('creates local file offers without requiring file data in memory', () => {
    const { setConversationPeers, createLocalMessage } = useChatStore.getState();
    const file = {
      mimeType: 'application/pdf',
      name: 'brief.pdf',
      size: 7,
    };

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    const message = createLocalMessage({
      myPeerId: 'local-peer',
      text: 'please accept',
      file,
      fileTransfer: {
        id: 'transfer-1',
        status: 'waiting',
        bytesTransferred: 0,
      },
    });

    expect(message?.kind).toBe('mixed');
    expect(message?.file?.dataUrl).toBeUndefined();
    expect(message?.fileTransfer).toEqual({
      id: 'transfer-1',
      status: 'waiting',
      bytesTransferred: 0,
    });
  });

  it('adds incoming file offers and updates transfer progress', () => {
    const { setConversationPeers, addIncomingFileOffer, updateFileTransfer } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    addIncomingFileOffer({
      type: 'CHAT_FILE_OFFER',
      version: 1,
      transferId: 'transfer-1',
      from: 'remote-peer',
      message: {
        id: 'transfer-1',
        kind: 'file',
        createdAt: 456,
        file: {
          mimeType: 'application/zip',
          name: 'logs.zip',
          size: 10,
        },
      },
    });

    expect(useChatStore.getState().messages).toMatchObject([
      {
        id: 'transfer-1',
        direction: 'in',
        kind: 'file',
        file: {
          name: 'logs.zip',
          size: 10,
        },
        fileTransfer: {
          id: 'transfer-1',
          status: 'offered',
          bytesTransferred: 0,
        },
      },
    ]);
    expect(useChatStore.getState().unreadCount).toBe(1);

    updateFileTransfer('transfer-1', {
      status: 'ready',
      bytesTransferred: 10,
      file: {
        objectUrl: 'blob:download',
      },
    });

    expect(useChatStore.getState().messages[0].fileTransfer).toMatchObject({
      status: 'ready',
      bytesTransferred: 10,
    });
    expect(useChatStore.getState().messages[0].file?.objectUrl).toBe('blob:download');
  });

  it('recreates transfer state when updating an existing file message without transfer metadata', () => {
    const { setConversationPeers, addIncomingWireMessage, updateFileTransfer } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    addIncomingWireMessage({
      type: 'CHAT_MESSAGE',
      message: {
        id: 'legacy-file-1',
        from: 'remote-peer',
        kind: 'file',
        file: {
          dataUrl: 'data:application/octet-stream;base64,YQ==',
          mimeType: 'application/octet-stream',
          name: 'legacy.bin',
          size: 1,
        },
        createdAt: 123,
      },
    });

    updateFileTransfer('legacy-file-1', {
      status: 'ready',
      bytesTransferred: 1,
      file: { objectUrl: 'blob:legacy' },
    });

    expect(useChatStore.getState().messages[0].fileTransfer).toMatchObject({
      id: 'legacy-file-1',
      status: 'ready',
      bytesTransferred: 1,
    });
    expect(useChatStore.getState().messages[0].file?.objectUrl).toBe('blob:legacy');
  });

  it('revokes object URLs when file downloads are replaced or cleared', () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
    });
    const { setConversationPeers, addIncomingFileOffer, updateFileTransfer } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    addIncomingFileOffer({
      type: 'CHAT_FILE_OFFER',
      version: 1,
      transferId: 'transfer-1',
      from: 'remote-peer',
      message: {
        id: 'transfer-1',
        kind: 'file',
        createdAt: 456,
        file: {
          mimeType: 'application/zip',
          name: 'logs.zip',
          size: 10,
        },
      },
    });

    updateFileTransfer('transfer-1', {
      status: 'ready',
      bytesTransferred: 10,
      file: { objectUrl: 'blob:first' },
    });
    updateFileTransfer('transfer-1', {
      status: 'ready',
      bytesTransferred: 10,
      file: { objectUrl: 'blob:second' },
    });
    setConversationPeers('local-peer', 'remote-peer', 'session-2');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
  });

  it('caps local messages and revokes only blob URLs evicted from memory', () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
    });
    const { setConversationPeers, createLocalMessage } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    for (let index = 0; index < MAX_CHAT_MESSAGES + 2; index += 1) {
      createLocalMessage({
        myPeerId: 'local-peer',
        id: `local-${index}`,
        file: {
          mimeType: 'application/octet-stream',
          name: `local-${index}.bin`,
          size: 1,
          objectUrl: index === 0 ? 'blob:evicted-local' : index === 1 ? 'https://example.com/file' : undefined,
        },
      });
    }

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(messages[0].id).toBe('local-2');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:evicted-local');
  });

  it('caps incoming wire messages', () => {
    const { setConversationPeers, addIncomingWireMessage } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    for (let index = 0; index < MAX_CHAT_MESSAGES + 1; index += 1) {
      addIncomingWireMessage({
        type: 'CHAT_MESSAGE',
        message: {
          id: `incoming-${index}`,
          from: 'remote-peer',
          kind: 'text',
          text: `message ${index}`,
          createdAt: index,
        },
      });
    }

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(messages[0].id).toBe('incoming-1');
  });

  it('caps incoming file offers and revokes an evicted download URL', () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
    });
    const { setConversationPeers, createLocalMessage, addIncomingFileOffer } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    createLocalMessage({
      myPeerId: 'local-peer',
      id: 'download-to-evict',
      file: {
        mimeType: 'application/octet-stream',
        name: 'download.bin',
        size: 1,
        objectUrl: 'blob:evicted-download',
      },
    });

    for (let index = 0; index < MAX_CHAT_MESSAGES; index += 1) {
      addIncomingFileOffer({
        type: 'CHAT_FILE_OFFER',
        version: 1,
        transferId: `transfer-${index}`,
        from: 'remote-peer',
        message: {
          id: `transfer-${index}`,
          kind: 'file',
          createdAt: index,
          file: {
            mimeType: 'application/octet-stream',
            name: `transfer-${index}.bin`,
            size: 1,
          },
        },
      });
    }

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(messages[0].id).toBe('transfer-0');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:evicted-download');
  });

  it('replaces an existing message without evicting another message', () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
    });
    const { setConversationPeers, createLocalMessage, addIncomingWireMessage } = useChatStore.getState();

    setConversationPeers('local-peer', 'remote-peer', 'session-1');
    for (let index = 0; index < MAX_CHAT_MESSAGES; index += 1) {
      createLocalMessage({
        myPeerId: 'local-peer',
        id: `message-${index}`,
        text: `local ${index}`,
      });
    }

    addIncomingWireMessage({
      type: 'CHAT_MESSAGE',
      message: {
        id: 'message-100',
        from: 'remote-peer',
        kind: 'text',
        text: 'replacement',
        createdAt: 999,
      },
    });

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(messages[0].id).toBe('message-0');
    expect(messages.at(-1)?.id).toBe(`message-${MAX_CHAT_MESSAGES - 1}`);
    expect(messages.find((message) => message.id === 'message-100')).toMatchObject({
      direction: 'in',
      text: 'replacement',
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
