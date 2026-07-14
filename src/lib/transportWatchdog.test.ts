import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchPeerTransport } from './transportWatchdog';

class FakePeerTransport extends EventTarget {
  iceConnectionState = 'checking';
  connectionState = 'connecting';

  setState(iceState: string, connectionState: string) {
    this.iceConnectionState = iceState;
    this.connectionState = connectionState;
    this.dispatchEvent(new Event('iceconnectionstatechange'));
    this.dispatchEvent(new Event('connectionstatechange'));
  }
}

describe('watchPeerTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after the connection establishment deadline', () => {
    const transport = new FakePeerTransport();
    const onRecovery = vi.fn();
    const cleanup = watchPeerTransport(transport, onRecovery);

    vi.advanceTimersByTime(14_999);
    expect(onRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenCalledOnce();

    cleanup();
  });

  it('cancels recovery after connecting and uses a five-second disconnected grace', () => {
    const transport = new FakePeerTransport();
    const onRecovery = vi.fn();
    const cleanup = watchPeerTransport(transport, onRecovery);

    transport.setState('connected', 'connected');
    vi.advanceTimersByTime(20_000);
    expect(onRecovery).not.toHaveBeenCalled();

    transport.setState('disconnected', 'connected');
    vi.advanceTimersByTime(4_999);
    expect(onRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenCalledOnce();

    cleanup();
  });

  it('recovers failed transport immediately and cleanup prevents callbacks', () => {
    const transport = new FakePeerTransport();
    const onRecovery = vi.fn();
    const cleanup = watchPeerTransport(transport, onRecovery);

    transport.setState('failed', 'failed');
    vi.advanceTimersByTime(0);
    expect(onRecovery).toHaveBeenCalledOnce();

    const second = new FakePeerTransport();
    const afterCleanup = vi.fn();
    const cleanupSecond = watchPeerTransport(second, afterCleanup);
    cleanupSecond();
    vi.advanceTimersByTime(20_000);
    expect(afterCleanup).not.toHaveBeenCalled();

    cleanup();
  });
});
