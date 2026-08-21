import { Directory, Filesystem } from '@capacitor/filesystem';

export const NATIVE_RECEIVED_FILES_DIRECTORY = 'SVC';

export interface NativeFileWritable {
  write: (data: BufferSource) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
}

type NativeFilesystemApi = Pick<
  typeof Filesystem,
  'checkPermissions' | 'requestPermissions' | 'writeFile' | 'appendFile' | 'deleteFile'
>;

const bufferSourceToBytes = (data: BufferSource) => (
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
);

export const bytesToBase64 = (data: BufferSource) => {
  const bytes = bufferSourceToBytes(data);
  const parts: string[] = [];
  const batchSize = 32 * 1024;

  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + batchSize)));
  }

  return btoa(parts.join(''));
};

export const sanitizeNativeFileName = (fileName: string) => {
  const sanitized = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === '/' || character === '\\' || codePoint <= 31 || codePoint === 127
      ? '_'
      : character;
  }).join('')
    .replace(/^\.+$/, '_')
    .trim();

  return sanitized || 'attachment';
};

export async function createNativeReceivedFileWritable(
  fileName: string,
  filesystem: NativeFilesystemApi = Filesystem,
): Promise<{ writable: NativeFileWritable; displayPath: string }> {
  const safeName = sanitizeNativeFileName(fileName);
  const path = `${NATIVE_RECEIVED_FILES_DIRECTORY}/${safeName}`;
  const currentPermissions = await filesystem.checkPermissions();
  const permissions = currentPermissions.publicStorage === 'granted'
    ? currentPermissions
    : await filesystem.requestPermissions();

  if (permissions.publicStorage !== 'granted') {
    throw new Error('需要存储权限才能接收文件');
  }

  await filesystem.writeFile({
    path,
    directory: Directory.Documents,
    data: '',
    recursive: true,
  });

  return {
    displayPath: `Documents/${path}`,
    writable: {
      write: async (data) => {
        await filesystem.appendFile({
          path,
          directory: Directory.Documents,
          data: bytesToBase64(data),
        });
      },
      close: async () => undefined,
      abort: async () => {
        await filesystem.deleteFile({
          path,
          directory: Directory.Documents,
        });
      },
    },
  };
}
