import { describe, expect, it } from 'vitest';
import {
  getFileFromDataTransfer,
  getFileFromFiles,
  getImageFileFromClipboardItems,
  getImageFileFromDataTransfer,
  isAcceptedChatImageType,
} from './chatAttachments';

const makeItem = (kind: string, type: string, file: File | null) => ({
  kind,
  type,
  getAsFile: () => file,
});

describe('chatAttachments', () => {
  it('returns the first supported image file from clipboard items', () => {
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const imageFile = new File(['image'], 'paste.png', { type: 'image/png' });

    const selected = getImageFileFromClipboardItems([
      makeItem('string', 'text/plain', textFile),
      makeItem('file', 'image/png', imageFile),
    ]);

    expect(selected).toBe(imageFile);
  });

  it('returns GIF files from clipboard items', () => {
    const gifFile = new File(['gif'], 'paste.gif', { type: 'image/gif' });

    const selected = getImageFileFromClipboardItems([
      makeItem('file', 'image/gif', gifFile),
      makeItem('file', 'image/png', null),
    ]);

    expect(selected).toBe(gifFile);
  });

  it('returns the first supported image file from dragged files', () => {
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const gifFile = new File(['gif'], 'drop.gif', { type: 'image/gif' });
    const pngFile = new File(['image'], 'drop.png', { type: 'image/png' });

    const selected = getImageFileFromDataTransfer({
      files: [textFile, gifFile, pngFile],
    } as unknown as DataTransfer);

    expect(selected).toBe(gifFile);
  });

  it('returns null when dragged files do not include supported images', () => {
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });

    const selected = getImageFileFromDataTransfer({
      files: [textFile],
    } as unknown as DataTransfer);

    expect(selected).toBeNull();
  });

  it('returns the first file from generic file lists', () => {
    const pdfFile = new File(['pdf'], 'brief.pdf', { type: 'application/pdf' });
    const zipFile = new File(['zip'], 'logs.zip', { type: 'application/zip' });

    expect(getFileFromFiles([pdfFile, zipFile])).toBe(pdfFile);
    expect(
      getFileFromDataTransfer({
        files: [pdfFile, zipFile],
      } as unknown as DataTransfer)
    ).toBe(pdfFile);
  });

  it('accepts the same image types used by chat payload validation', () => {
    expect(isAcceptedChatImageType('image/jpeg')).toBe(true);
    expect(isAcceptedChatImageType('image/png')).toBe(true);
    expect(isAcceptedChatImageType('image/webp')).toBe(true);
    expect(isAcceptedChatImageType('image/gif')).toBe(true);
    expect(isAcceptedChatImageType('image/svg+xml')).toBe(false);
  });
});
