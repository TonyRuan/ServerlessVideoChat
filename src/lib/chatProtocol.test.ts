import { describe, expect, it } from 'vitest';
import {
  CHAT_FILE_STREAM_CHUNK_BYTES,
  createWireChatFileAccept,
  createWireChatFileDecline,
  createWireChatFileOffer,
  createWireChatFileStreamChunk,
  createSessionResumeMessage,
  createWireChatMessage,
  isWireChatFileAcceptPayload,
  isWireChatFileChunkPayload,
  isWireChatFileDeclinePayload,
  isWireChatFileOfferPayload,
  isSessionResumePayload,
  isWireChatPayload,
} from './chatProtocol';
import {
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_DATA_URL_CHARS,
  type ChatMessage,
} from './chatStorage';

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

  it('accepts GIF image payloads within the accepted chat limits', () => {
    expect(
      isWireChatPayload({
        type: 'CHAT_MESSAGE',
        message: {
          id: 'gif-1',
          from: 'p',
          kind: 'image',
          createdAt: 1,
          image: {
            dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
            mimeType: 'image/gif',
            name: 'animated.gif',
            size: MAX_CHAT_IMAGE_BYTES,
          },
        },
      })
    ).toBe(true);
  });

  it('rejects downloadable file payloads in regular chat messages', () => {
    expect(
      isWireChatPayload({
        type: 'CHAT_MESSAGE',
        message: {
          id: 'file-1',
          from: 'p',
          kind: 'file',
          createdAt: 1,
          file: {
            dataUrl: 'data:application/pdf;base64,JVBERi0=',
            mimeType: 'application/pdf',
            name: 'brief.pdf',
            size: 5,
          },
        },
      })
    ).toBe(false);
  });

  it('rejects text plus downloadable file payloads in regular chat messages', () => {
    expect(
      isWireChatPayload({
        type: 'CHAT_MESSAGE',
        message: {
          id: 'file-2',
          from: 'p',
          kind: 'mixed',
          text: 'see attached',
          createdAt: 1,
          file: {
            dataUrl: 'data:application/zip;base64,UEs=',
            mimeType: 'application/zip',
            name: 'logs.zip',
            size: 2,
          },
        },
      })
    ).toBe(false);
  });

  it('creates and validates a file offer without embedding file data', () => {
    const fileMessage: ChatMessage = {
      id: 'offer-1',
      conversationId: 'a:b',
      direction: 'out',
      kind: 'mixed',
      text: 'please accept',
      file: {
        mimeType: 'application/pdf',
        name: 'brief.pdf',
        size: 12345,
      },
      fileTransfer: {
        id: 'offer-1',
        status: 'waiting',
        bytesTransferred: 0,
      },
      createdAt: 111,
      status: 'sending',
    };

    const offer = createWireChatFileOffer(fileMessage, 'peer-a');

    expect(offer).toEqual({
      type: 'CHAT_FILE_OFFER',
      version: 1,
      transferId: 'offer-1',
      from: 'peer-a',
      message: {
        id: 'offer-1',
        kind: 'mixed',
        text: 'please accept',
        createdAt: 111,
        file: {
          mimeType: 'application/pdf',
          name: 'brief.pdf',
          size: 12345,
        },
      },
    });
    expect(isWireChatFileOfferPayload(offer)).toBe(true);
    expect(JSON.stringify(offer)).not.toContain('base64');
    expect(isWireChatFileOfferPayload({ ...offer, message: { ...offer.message, kind: 'text' } })).toBe(false);
    expect(isWireChatFileOfferPayload({
      ...offer,
      message: {
        ...offer.message,
        file: {
          ...offer.message.file,
          size: MAX_CHAT_FILE_BYTES,
        },
      },
    })).toBe(true);
    expect(isWireChatFileOfferPayload({
      ...offer,
      message: {
        ...offer.message,
        file: {
          ...offer.message.file,
          size: MAX_CHAT_FILE_BYTES + 1,
        },
      },
    })).toBe(false);
  });

  it('creates and validates file accept and decline payloads', () => {
    const accepted = createWireChatFileAccept('transfer-1', 'peer-b', 'file-system');
    const declined = createWireChatFileDecline('transfer-1', 'peer-b');

    expect(isWireChatFileAcceptPayload(accepted)).toBe(true);
    expect(isWireChatFileDeclinePayload(declined)).toBe(true);
    expect(isWireChatFileAcceptPayload({ ...accepted, saveMode: 'unknown' })).toBe(false);
    expect(isWireChatFileDeclinePayload({ ...declined, transferId: '' })).toBe(false);
  });

  it('creates and validates stream chunks from raw base64 data', () => {
    const chunkBody = 'QUJD'.repeat(Math.floor(CHAT_FILE_STREAM_CHUNK_BYTES / 3));
    const chunk = createWireChatFileStreamChunk({
      transferId: 'transfer-1',
      from: 'peer-a',
      index: 2,
      offset: CHAT_FILE_STREAM_CHUNK_BYTES * 2,
      data: chunkBody,
    });

    expect(chunk).toEqual({
      type: 'CHAT_FILE_STREAM_CHUNK',
      version: 1,
      transferId: 'transfer-1',
      from: 'peer-a',
      chunk: {
        index: 2,
        offset: CHAT_FILE_STREAM_CHUNK_BYTES * 2,
        data: chunkBody,
      },
    });
    expect(isWireChatFileChunkPayload(chunk)).toBe(true);
    expect(isWireChatFileChunkPayload({ ...chunk, chunk: { ...chunk.chunk, data: 'not base64' } })).toBe(false);
    expect(isWireChatFileChunkPayload({ ...chunk, chunk: { ...chunk.chunk, data: `${chunkBody}AAAA` } })).toBe(false);
    expect(isWireChatFileChunkPayload({ ...chunk, chunk: { ...chunk.chunk, index: Number.MAX_SAFE_INTEGER + 1 } })).toBe(false);
    expect(isWireChatFileChunkPayload({ ...chunk, chunk: { ...chunk.chunk, offset: Infinity } })).toBe(false);
    expect(isWireChatFileChunkPayload({ ...chunk, chunk: { ...chunk.chunk, offset: CHAT_FILE_STREAM_CHUNK_BYTES } })).toBe(false);
    expect(isWireChatFileChunkPayload({ ...chunk, chunk: { ...chunk.chunk, offset: MAX_CHAT_FILE_BYTES } })).toBe(false);
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

  it('rejects payloads that try to send both image and file attachments', () => {
    expect(
      isWireChatPayload({
        type: 'CHAT_MESSAGE',
        message: {
          id: 'x',
          from: 'p',
          kind: 'mixed',
          text: 'too many attachments',
          createdAt: 1,
          image: {
            dataUrl: 'data:image/png;base64,abc',
            mimeType: 'image/png',
            name: 'a.png',
            size: 3,
          },
          file: {
            dataUrl: 'data:application/pdf;base64,abc',
            mimeType: 'application/pdf',
            name: 'a.pdf',
            size: 3,
          },
        },
      })
    ).toBe(false);
  });

  it('creates and validates session resume payloads', () => {
    const payload = createSessionResumeMessage({
      sessionId: 'session-1',
      peerId: 'peer-a',
      role: 'host',
    });

    expect(payload).toEqual({
      type: 'SESSION_RESUME',
      version: 1,
      sessionId: 'session-1',
      peerId: 'peer-a',
      role: 'host',
    });
    expect(isSessionResumePayload(payload)).toBe(true);
    expect(isSessionResumePayload({ ...payload, peerId: 'http://bad' })).toBe(false);
    expect(isSessionResumePayload({ ...payload, role: 'admin' })).toBe(false);
  });
});
