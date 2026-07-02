export const ACCEPTED_CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

interface ClipboardLikeItem {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export function isAcceptedChatImageType(type: string) {
  return ACCEPTED_CHAT_IMAGE_TYPES.includes(type as (typeof ACCEPTED_CHAT_IMAGE_TYPES)[number]);
}

export function getImageFileFromClipboardItems(items: ArrayLike<ClipboardLikeItem>) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== 'file' || !isAcceptedChatImageType(item.type)) continue;

    const file = item.getAsFile();
    if (file && isAcceptedChatImageType(file.type || item.type)) {
      return file;
    }
  }

  return null;
}

export function getImageFileFromFiles(files: ArrayLike<File>) {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file && isAcceptedChatImageType(file.type)) {
      return file;
    }
  }

  return null;
}

export function getFileFromFiles(files: ArrayLike<File>) {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file) return file;
  }

  return null;
}

export function getImageFileFromDataTransfer(dataTransfer: Pick<DataTransfer, 'files'>) {
  return getImageFileFromFiles(dataTransfer.files);
}

export function getFileFromDataTransfer(dataTransfer: Pick<DataTransfer, 'files'>) {
  return getFileFromFiles(dataTransfer.files);
}
