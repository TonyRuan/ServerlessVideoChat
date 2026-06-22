import { create } from 'zustand';
import {
  loadChatDraft,
  loadChatMessages,
  makeConversationId,
  saveChatDraft,
  saveChatMessages,
  type ChatImageAttachment,
  type ChatKind,
  type ChatMessage,
  type ChatStatus,
} from '../lib/chatStorage';
import type { WireChatPayload } from '../lib/chatProtocol';

interface CreateLocalMessageInput {
  myPeerId: string;
  text?: string;
  image?: ChatImageAttachment;
}

interface ChatStore {
  conversationId: string | null;
  peerId: string | null;
  messages: ChatMessage[];
  draftText: string;
  isPanelOpen: boolean;
  unreadCount: number;
  setConversationPeers: (myPeerId: string, peerId: string) => void;
  setDraftText: (text: string) => void;
  setPanelOpen: (isOpen: boolean) => void;
  createLocalMessage: (input: CreateLocalMessageInput) => ChatMessage | null;
  addIncomingWireMessage: (payload: WireChatPayload) => void;
  updateMessageStatus: (id: string, status: ChatStatus) => void;
}

const createMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getKind = (text?: string, image?: ChatImageAttachment): ChatKind | null => {
  const hasText = Boolean(text?.trim());
  const hasImage = Boolean(image);

  if (hasText && hasImage) return 'mixed';
  if (hasText) return 'text';
  if (hasImage) return 'image';
  return null;
};

const upsertMessage = (messages: ChatMessage[], message: ChatMessage) => {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) return [...messages, message];

  const nextMessages = [...messages];
  nextMessages[existingIndex] = message;
  return nextMessages;
};

const persistMessages = (conversationId: string | null, messages: ChatMessage[]) => {
  if (conversationId) {
    saveChatMessages(conversationId, messages);
  }
};

export const useChatStore = create<ChatStore>((set, get) => ({
  conversationId: null,
  peerId: null,
  messages: [],
  draftText: '',
  isPanelOpen: false,
  unreadCount: 0,
  setConversationPeers: (myPeerId, peerId) => {
    const conversationId = makeConversationId(myPeerId, peerId);
    const current = get();
    if (current.conversationId === conversationId) return;

    set({
      conversationId,
      peerId,
      messages: loadChatMessages(conversationId),
      draftText: loadChatDraft(conversationId),
      unreadCount: 0,
    });
  },
  setDraftText: (text) => {
    const { conversationId } = get();
    if (conversationId) saveChatDraft(conversationId, text);
    set({ draftText: text });
  },
  setPanelOpen: (isPanelOpen) => {
    set({ isPanelOpen, unreadCount: isPanelOpen ? 0 : get().unreadCount });
  },
  createLocalMessage: ({ myPeerId, text, image }) => {
    const state = get();
    const kind = getKind(text, image);
    if (!state.conversationId || !kind) return null;

    const message: ChatMessage = {
      id: createMessageId(),
      conversationId: state.conversationId,
      direction: 'out',
      kind,
      text: text?.trim() || undefined,
      image,
      createdAt: Date.now(),
      status: 'sending',
    };

    const messages = upsertMessage(state.messages, message);
    persistMessages(state.conversationId, messages);
    saveChatDraft(state.conversationId, '');
    set({ messages, draftText: '' });

    void myPeerId;
    return message;
  },
  addIncomingWireMessage: (payload) => {
    const state = get();
    if (!state.conversationId) return;

    const message: ChatMessage = {
      id: payload.message.id,
      conversationId: state.conversationId,
      direction: 'in',
      kind: payload.message.kind,
      text: payload.message.text,
      image: payload.message.image,
      createdAt: payload.message.createdAt,
      status: 'received',
    };

    const messages = upsertMessage(state.messages, message);
    persistMessages(state.conversationId, messages);
    set({
      messages,
      unreadCount: state.isPanelOpen ? state.unreadCount : state.unreadCount + 1,
    });
  },
  updateMessageStatus: (id, status) => {
    const state = get();
    const messages = state.messages.map((message) =>
      message.id === id ? { ...message, status } : message
    );
    persistMessages(state.conversationId, messages);
    set({ messages });
  },
}));
