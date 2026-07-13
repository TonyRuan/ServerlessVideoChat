import { describe, expect, it, vi } from 'vitest';

import { createMediaStreamLifecycle } from './mediaStreamLifecycle';

interface FakeTrack {
  stop(): void;
}

interface FakeStream {
  name: string;
  getTracks: () => FakeTrack[];
}

function createFakeStream(name: string, onStop?: () => void) {
  const stop = vi.fn(() => onStop?.());
  const track: FakeTrack = {
    stop,
  };
  const stream: FakeStream = {
    name,
    getTracks: () => [track],
  };

  return { stream, stop };
}

describe('createMediaStreamLifecycle', () => {
  it('lets only the most recently started request commit', () => {
    const lifecycle = createMediaStreamLifecycle<FakeStream>();
    const firstRequest = lifecycle.beginRequest();
    const secondRequest = lifecycle.beginRequest();
    const first = createFakeStream('first');
    const second = createFakeStream('second');

    expect(lifecycle.commit(secondRequest, second.stream)).toBe(true);
    expect(lifecycle.commit(firstRequest, first.stream)).toBe(false);

    expect(lifecycle.current()).toBe(second.stream);
    expect(second.stop).not.toHaveBeenCalled();
  });

  it('stops a stream immediately when its request is stale', () => {
    const lifecycle = createMediaStreamLifecycle<FakeStream>();
    const staleRequest = lifecycle.beginRequest();
    lifecycle.beginRequest();
    const stale = createFakeStream('stale');

    expect(lifecycle.commit(staleRequest, stale.stream)).toBe(false);
    expect(stale.stop).toHaveBeenCalledOnce();
    expect(lifecycle.current()).toBeNull();
  });

  it('invalidates an unfinished request when cleanup runs', () => {
    const lifecycle = createMediaStreamLifecycle<FakeStream>();
    const pendingRequest = lifecycle.beginRequest();

    lifecycle.cleanup();

    const late = createFakeStream('late');
    expect(lifecycle.commit(pendingRequest, late.stream)).toBe(false);
    expect(late.stop).toHaveBeenCalledOnce();
    expect(lifecycle.current()).toBeNull();
  });

  it('keeps the old stream alive until a replacement commits successfully', () => {
    const lifecycle = createMediaStreamLifecycle<FakeStream>();
    const initial = createFakeStream('initial', () => {
      expect(lifecycle.current()).toBe(replacement.stream);
    });
    const initialRequest = lifecycle.beginRequest();
    expect(lifecycle.commit(initialRequest, initial.stream)).toBe(true);

    lifecycle.beginRequest();
    expect(lifecycle.current()).toBe(initial.stream);
    expect(initial.stop).not.toHaveBeenCalled();

    const replacement = createFakeStream('replacement');
    const replacementRequest = lifecycle.beginRequest();
    expect(lifecycle.commit(replacementRequest, replacement.stream)).toBe(true);

    expect(lifecycle.current()).toBe(replacement.stream);
    expect(initial.stop).toHaveBeenCalledOnce();
    expect(replacement.stop).not.toHaveBeenCalled();
  });
});
