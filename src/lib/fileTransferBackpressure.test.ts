import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForFileDataChannelBuffer } from './fileTransferBackpressure';

class Channel extends EventTarget {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 1024;
  bufferedAmountLowThreshold = 0;
  drain(amount: number, dispatch = true) {
    this.bufferedAmount = amount;
    if (dispatch) this.dispatchEvent(new Event('bufferedamountlow'));
  }
}

const options = { isCurrent: () => true, highWaterMarkBytes: 256, lowWaterMarkBytes: 128, fallbackPollMs: 250 };

describe('file transfer browser queue backpressure', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('does not delay an open active channel under the high watermark', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    channel.bufferedAmount = 256;
    await waitForFileDataChannelBuffer(channel, options);
    expect(vi.getTimerCount()).toBe(0);
    expect(channel.bufferedAmountLowThreshold).toBe(0);
  });

  it('waits for low water and wakes immediately without waiting for the timer', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    const done = vi.fn();
    const result = waitForFileDataChannelBuffer(channel, options).then(done);
    channel.drain(200);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    channel.drain(128);
    await result;
    expect(done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(channel.bufferedAmountLowThreshold).toBe(0);
  });

  it('handles a drain between the first check and listener installation', async () => {
    const channel = new Channel();
    const add = channel.addEventListener.bind(channel);
    vi.spyOn(channel, 'addEventListener').mockImplementation((...args) => {
      if (args[0] === 'bufferedamountlow') channel.drain(0);
      add(...args);
    });
    await waitForFileDataChannelBuffer(channel, options);
    expect(channel.bufferedAmountLowThreshold).toBe(0);
  });

  it('recovers a missed low-water event via bounded-frequency polling', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    const result = waitForFileDataChannelBuffer(channel, options);
    channel.drain(0, false);
    await vi.advanceTimersByTimeAsync(250);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['close', 'error'])('rejects on %s and removes all listeners and polling', async (type) => {
    vi.useFakeTimers();
    const channel = new Channel();
    const remove = vi.spyOn(channel, 'removeEventListener');
    const result = expect(waitForFileDataChannelBuffer(channel, options)).rejects.toThrow();
    channel.dispatchEvent(new Event(type));
    await result;
    expect(remove.mock.calls.map(([name]) => name)).toEqual(['bufferedamountlow', 'close', 'error']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects stale runs instead of allowing the next send', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    let current = true;
    const send = vi.fn();
    const promise = waitForFileDataChannelBuffer(channel, { ...options, isCurrent: () => current }).then(send);
    const result = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    current = false;
    channel.drain(0);
    await result;
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes cancellation without any channel event', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    let current = true;
    const result = expect(waitForFileDataChannelBuffer(channel, { ...options, isCurrent: () => current })).rejects.toMatchObject({ name: 'AbortError' });
    current = false;
    await vi.advanceTimersByTimeAsync(250);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supports immediate abort independently of the fallback poll', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    const controller = new AbortController();
    const result = expect(waitForFileDataChannelBuffer(channel, { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks connection and generation even when the buffer is already empty', async () => {
    const channel = new Channel();
    channel.bufferedAmount = 0;
    await expect(waitForFileDataChannelBuffer(channel, { ...options, isCurrent: () => false })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(waitForFileDataChannelBuffer(channel, { ...options, isConnectionOpen: () => false })).rejects.toThrow('聊天连接已断开');
    channel.readyState = 'closed';
    await expect(waitForFileDataChannelBuffer(channel, options)).rejects.toThrow('聊天连接已断开');
  });

  it('keeps concurrent waits independent and restores the original threshold after the last wait', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    channel.bufferedAmountLowThreshold = 17;
    const controller = new AbortController();
    const first = expect(waitForFileDataChannelBuffer(channel, { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const second = waitForFileDataChannelBuffer(channel, { ...options, lowWaterMarkBytes: 64 });
    expect(channel.bufferedAmountLowThreshold).toBe(128);
    controller.abort();
    await first;
    expect(channel.bufferedAmountLowThreshold).toBe(64);
    expect(vi.getTimerCount()).toBe(1);
    channel.drain(64);
    await second;
    expect(channel.bufferedAmountLowThreshold).toBe(17);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overwrite a threshold changed by another channel owner', async () => {
    const channel = new Channel();
    const result = waitForFileDataChannelBuffer(channel, options);
    channel.bufferedAmountLowThreshold = 33;
    channel.drain(0);
    await result;
    expect(channel.bufferedAmountLowThreshold).toBe(33);
  });

  it('wakes parallel waits at their own low watermarks', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    const lowerDone = vi.fn();
    const first = waitForFileDataChannelBuffer(channel, options);
    const second = waitForFileDataChannelBuffer(channel, { ...options, lowWaterMarkBytes: 64 }).then(lowerDone);
    channel.drain(128);
    await first;
    expect(lowerDone).not.toHaveBeenCalled();
    expect(channel.bufferedAmountLowThreshold).toBe(64);
    channel.drain(64);
    await second;
    expect(lowerDone).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid pacing parameters before adding timers or listeners', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    await expect(waitForFileDataChannelBuffer(channel, { ...options, lowWaterMarkBytes: 256 })).rejects.toThrow(RangeError);
    await expect(waitForFileDataChannelBuffer(channel, { ...options, fallbackPollMs: 0 })).rejects.toThrow(RangeError);
    expect(vi.getTimerCount()).toBe(0);
    expect(channel.bufferedAmountLowThreshold).toBe(0);
  });
});
