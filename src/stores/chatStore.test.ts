import { describe, expect, it, beforeEach, vi } from 'vitest';
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
});
