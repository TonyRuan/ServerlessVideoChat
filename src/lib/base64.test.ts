import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';

describe('base64', () => {
  it('round-trips binary bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);
    const base64 = bytesToBase64(bytes);

    expect(base64ToBytes(base64)).toEqual(bytes);
  });
});
