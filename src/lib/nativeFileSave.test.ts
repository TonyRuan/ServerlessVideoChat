import { describe, expect, it, vi } from 'vitest';
import { Directory } from '@capacitor/filesystem';
import {
  bytesToBase64,
  createNativeReceivedFileWritable,
  sanitizeNativeFileName,
} from './nativeFileSave';

describe('nativeFileSave', () => {
  it('sanitizes remote file names before writing into Documents', () => {
    expect(sanitizeNativeFileName('../unsafe/name.txt')).toBe('.._unsafe_name.txt');
    expect(sanitizeNativeFileName('...')).toBe('_');
    expect(sanitizeNativeFileName('')).toBe('attachment');
  });

  it('encodes binary chunks without losing zero or high bytes', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 127, 128, 255]))).toBe('AAF/gP8=');
  });

  it('streams chunks into the app Documents directory and removes partial files on abort', async () => {
    const filesystem = {
      checkPermissions: vi.fn().mockResolvedValue({ publicStorage: 'granted' }),
      requestPermissions: vi.fn().mockResolvedValue({ publicStorage: 'granted' }),
      writeFile: vi.fn().mockResolvedValue({ uri: 'file:///documents/SVC/report.bin' }),
      appendFile: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };
    const result = await createNativeReceivedFileWritable('report.bin', filesystem);

    expect(filesystem.writeFile).toHaveBeenCalledWith({
      path: 'SVC/report.bin',
      directory: Directory.Documents,
      data: '',
      recursive: true,
    });
    expect(filesystem.requestPermissions).not.toHaveBeenCalled();
    expect(result.displayPath).toBe('Documents/SVC/report.bin');

    await result.writable.write(new Uint8Array([1, 2, 3]));
    expect(filesystem.appendFile).toHaveBeenCalledWith({
      path: 'SVC/report.bin',
      directory: Directory.Documents,
      data: 'AQID',
    });

    await result.writable.abort();
    expect(filesystem.deleteFile).toHaveBeenCalledWith({
      path: 'SVC/report.bin',
      directory: Directory.Documents,
    });
  });

  it('requests legacy public-storage permission and stops when it is denied', async () => {
    const filesystem = {
      checkPermissions: vi.fn().mockResolvedValue({ publicStorage: 'prompt' }),
      requestPermissions: vi.fn().mockResolvedValue({ publicStorage: 'denied' }),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    await expect(createNativeReceivedFileWritable('report.bin', filesystem))
      .rejects.toThrow('需要存储权限才能接收文件');
    expect(filesystem.requestPermissions).toHaveBeenCalledOnce();
    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });
});
