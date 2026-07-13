import { create } from 'zustand';
import {
  makeConversationId,
  MAX_CHAT_MESSAGES,
  purgePersistedChatStorage,
  type ChatFileAttachment,
  type ChatFileTransfer,
  type ChatImageAttachment,
  type ChatKind,
  type ChatMessage,
  type ChatStatus,
} from '../lib/chatStorage';
import type { WireChatFileOfferPayload, WireChatPayload } from '../lib/chatProtocol';

interface CreateLocalMessageInput {
  myPeerId: string;
  id?: string;
  text?: string;
  image?: ChatImageAttachment;
  file?: ChatFileAttachment;
  fileTransfer?: ChatFileTransfer;
}

interface UpdateFileTransferInput extends Partial<ChatFileTransfer> {
  file?: Partial<ChatFileAttachment>;
}

interface ChatStore {
  conversationId: string | null;
  peerId: string | null;
  messages: ChatMessage[];
  draftText: string;
  isPanelOpen: boolean;
  unreadCount: number;
  setConversationPeers: (myPeerId: string, peerId: string, callSessionId?: string) => void;
  setDraftText: (text: string) => void;
  setPanelOpen: (isOpen: boolean) => void;
  createLocalMessage: (input: CreateLocalMessageInput) => ChatMessage | null;
  addIncomingWireMessage: (payload: WireChatPayload) => void;
  addIncomingFileOffer: (payload: WireChatFileOfferPayload) => void;
  updateFileTransfer: (id: string, input: UpdateFileTransferInput) => void;
  updateMessageStatus: (id: string, status: ChatStatus) => void;
}

const createMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getKind = (text?: string, image?: ChatImageAttachment, file?: ChatFileAttachment): ChatKind | null => {
  const hasText = Boolean(text?.trim());
  const hasImage = Boolean(image);
  const hasFile = Boolean(file);

  if (hasImage && hasFile) return null;
  if (hasText && hasFile) return 'mixed';
  if (hasText && hasImage) return 'mixed';
  if (hasText) return 'text';
  if (hasImage) return 'image';
  if (hasFile) return 'file';
  return null;
};

const upsertMessage = (messages: ChatMessage[], message: ChatMessage) => {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) return limitMessagesInMemory([...messages, message]);

  const nextMessages = [...messages];
  revokeReplacedObjectUrl(nextMessages[existingIndex], message);
  nextMessages[existingIndex] = message;
  return limitMessagesInMemory(nextMessages);
};

const revokeObjectUrl = (objectUrl: string | undefined) => {
  if (!objectUrl?.startsWith('blob:')) return;
  URL.revokeObjectURL?.(objectUrl);
};

const revokeReplacedObjectUrl = (previous: ChatMessage | undefined, next: ChatMessage | undefined) => {
  const previousUrl = previous?.file?.objectUrl;
  const nextUrl = next?.file?.objectUrl;
  if (previousUrl && previousUrl !== nextUrl) {
    revokeObjectUrl(previousUrl);
  }
};

const revokeMessageObjectUrls = (messages: ChatMessage[]) => {
  for (const message of messages) {
    revokeObjectUrl(message.file?.objectUrl);
  }
};

const limitMessagesInMemory = (messages: ChatMessage[]) => {
  const overflowCount = messages.length - MAX_CHAT_MESSAGES;
  if (overflowCount <= 0) return messages;

  revokeMessageObjectUrls(messages.slice(0, overflowCount));
  return messages.slice(overflowCount);
};

const updateTransferStats = (
  previous: ChatFileTransfer,
  patch: Partial<ChatFileTransfer>
): ChatFileTransfer => {
  const now = Date.now();
  const next: ChatFileTransfer = {
    ...previous,
    ...patch,
  };

  if (next.status === 'transferring') {
    next.startedAt = previous.startedAt ?? now;
    next.updatedAt = now;
    const elapsedSeconds = Math.max((next.updatedAt - next.startedAt) / 1000, 0);
    next.bytesPerSecond = elapsedSeconds > 0 ? next.bytesTransferred / elapsedSeconds : previous.bytesPerSecond;
  } else if (previous.startedAt) {
    next.startedAt = previous.startedAt;
    next.updatedAt = now;
    next.bytesPerSecond = previous.bytesPerSecond;
  }

  return next;
};

const createFileTransferFromPatch = (
  id: string,
  patch: Partial<ChatFileTransfer>
): ChatFileTransfer => ({
  id: patch.id ?? id,
  status: patch.status ?? 'transferring',
  bytesTransferred: patch.bytesTransferred ?? 0,
  ...patch,
});

purgePersistedChatStorage();

export const useChatStore = create<ChatStore>((set, get) => ({
  conversationId: null,
  peerId: null,
  messages: [],
  draftText: '',
  isPanelOpen: false,
  unreadCount: 0,
  setConversationPeers: (myPeerId, peerId, callSessionId) => {
    const conversationId = makeConversationId(myPeerId, peerId, callSessionId);
    const current = get();
    if (current.conversationId === conversationId) {
      if (current.peerId !== peerId) set({ peerId });
      return;
    }

    revokeMessageObjectUrls(current.messages);
    set({
      conversationId,
      peerId,
      messages: [],
      draftText: '',
      unreadCount: 0,
    });
  },
  setDraftText: (text) => {
    set({ draftText: text });
  },
  setPanelOpen: (isPanelOpen) => {
    set({ isPanelOpen, unreadCount: isPanelOpen ? 0 : get().unreadCount });
  },
  createLocalMessage: ({ myPeerId, id, text, image, file, fileTransfer }) => {
    const state = get();
    const kind = getKind(text, image, file);
    if (!state.conversationId || !kind) return null;

    const message: ChatMessage = {
      id: id ?? createMessageId(),
      conversationId: state.conversationId,
      direction: 'out',
      kind,
      text: text?.trim() || undefined,
      image,
      file,
      fileTransfer,
      createdAt: Date.now(),
      status: 'sending',
    };

    const messages = upsertMessage(state.messages, message);
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
      file: payload.message.file,
      createdAt: payload.message.createdAt,
      status: 'received',
    };

    const messages = upsertMessage(state.messages, message);
    set({
      messages,
      unreadCount: state.isPanelOpen ? state.unreadCount : state.unreadCount + 1,
    });
  },
  addIncomingFileOffer: (payload) => {
    const state = get();
    if (!state.conversationId) return;

    const message: ChatMessage = {
      id: payload.message.id,
      conversationId: state.conversationId,
      direction: 'in',
      kind: payload.message.kind,
      text: payload.message.text,
      file: payload.message.file,
      fileTransfer: {
        id: payload.transferId,
        status: 'offered',
        bytesTransferred: 0,
      },
      createdAt: payload.message.createdAt,
      status: 'received',
    };

    const messages = upsertMessage(state.messages, message);
    set({
      messages,
      unreadCount: state.isPanelOpen ? state.unreadCount : state.unreadCount + 1,
    });
  },
  updateFileTransfer: (id, input) => {
    const state = get();
    const { file, ...transferPatch } = input;
    const messages = state.messages.map((message) => {
      if (message.id !== id) return message;

      const nextMessage = {
        ...message,
        file: file ? { ...message.file, ...file } as ChatFileAttachment : message.file,
        fileTransfer: message.fileTransfer
          ? updateTransferStats(message.fileTransfer, transferPatch)
          : message.file
            ? updateTransferStats(createFileTransferFromPatch(id, transferPatch), transferPatch)
            : message.fileTransfer,
      };
      revokeReplacedObjectUrl(message, nextMessage);
      return nextMessage;
    });
    set({ messages });
  },
  updateMessageStatus: (id, status) => {
    const state = get();
    const messages = state.messages.map((message) =>
      message.id === id ? { ...message, status } : message
    );
    set({ messages });
  },
}));
