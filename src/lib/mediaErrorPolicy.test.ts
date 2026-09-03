import { describe, expect, it } from 'vitest';
import { describeMediaError } from './mediaErrorPolicy';

function namedError(name: string) {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('mediaErrorPolicy', () => {
  it('describes permission failures without calling them network errors', () => {
    const result = describeMediaError(namedError('NotAllowedError'));
    expect(result.title).toContain('摄像头或麦克风');
    expect(result.message).toContain('权限');
    expect(result.message).not.toContain('网络');
  });

  it('provides actionable device-busy guidance', () => {
    expect(describeMediaError(namedError('NotReadableError')).message).toContain('占用');
  });
});
