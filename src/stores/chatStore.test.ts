import { describe, expect, it, beforeEach } from 'vitest';
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
});
