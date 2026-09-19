export type FileDataChannel = Pick<RTCDataChannel,
  'readyState' | 'bufferedAmount' | 'bufferedAmountLowThreshold' | 'addEventListener' | 'removeEventListener'>;

export interface FileTransferBackpressureOptions {
  isCurrent: () => boolean;
  isConnectionOpen?: () => boolean;
  signal?: AbortSignal;
  highWaterMarkBytes?: number;
  lowWaterMarkBytes?: number;
  fallbackPollMs?: number;
}

// These are tunable pacing values, not a claim about every network's optimum.
export const FILE_BUFFER_HIGH_WATER_BYTES = 256 * 1024;
export const FILE_BUFFER_LOW_WATER_BYTES = 128 * 1024;
export const FILE_BUFFER_FALLBACK_POLL_MS = 250;

type ThresholdState = { original: number; installed: number; waiters: Map<symbol, number> };
const thresholds = new WeakMap<FileDataChannel, ThresholdState>();

function reserveThreshold(channel: FileDataChannel, lowWaterMark: number) {
  const key = Symbol();
  const state = thresholds.get(channel) ?? {
    original: channel.bufferedAmountLowThreshold,
    installed: channel.bufferedAmountLowThreshold,
    waiters: new Map<symbol, number>(),
  };
  state.waiters.set(key, lowWaterMark);
  state.installed = Math.max(...state.waiters.values());
  thresholds.set(channel, state);
  channel.bufferedAmountLowThreshold = state.installed;
  return () => {
    state.waiters.delete(key);
    const next = state.waiters.size ? Math.max(...state.waiters.values()) : state.original;
    // Do not undo a threshold changed by an unrelated channel owner.
    if (channel.bufferedAmountLowThreshold === state.installed) channel.bufferedAmountLowThreshold = next;
    state.installed = next;
    if (!state.waiters.size) thresholds.delete(channel);
  };
}

/**
 * Call after a bulk send. Above the high watermark, wait for the low watermark.
 * The caller must also check its generation immediately before the next send.
 * Events provide the normal wakeup; polling covers lost events and stale runs.
 * This limits the browser queue only, not PeerJS's internal serialization queue.
 */
export function waitForFileDataChannelBuffer(
  channel: FileDataChannel,
  {
    isCurrent, isConnectionOpen = () => true, signal,
    highWaterMarkBytes = FILE_BUFFER_HIGH_WATER_BYTES,
    lowWaterMarkBytes = FILE_BUFFER_LOW_WATER_BYTES,
    fallbackPollMs = FILE_BUFFER_FALLBACK_POLL_MS,
  }: FileTransferBackpressureOptions,
): Promise<void> {
  if (!Number.isSafeInteger(highWaterMarkBytes) || highWaterMarkBytes < 1 || highWaterMarkBytes > 0xffffffff
    || !Number.isSafeInteger(lowWaterMarkBytes) || lowWaterMarkBytes < 0 || lowWaterMarkBytes >= highWaterMarkBytes
    || !Number.isFinite(fallbackPollMs) || fallbackPollMs < 1) {
    return Promise.reject(new RangeError('Invalid file buffer watermarks or poll interval'));
  }

  const assertActive = () => {
    if (signal?.aborted || !isCurrent()) throw new DOMException('File transfer cancelled', 'AbortError');
    if (!isConnectionOpen() || channel.readyState !== 'open') throw new Error('聊天连接已断开');
  };

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let releaseThreshold: (() => void) | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      channel.removeEventListener('bufferedamountlow', check);
      channel.removeEventListener('close', onClose);
      channel.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      releaseThreshold?.();
      if (error) reject(error);
      else resolve();
    };
    function check() {
      try {
        assertActive();
        if (channel.bufferedAmount <= lowWaterMarkBytes) finish();
      } catch (error) { finish(error); }
    }
    const onClose = () => finish(new Error('聊天连接已断开'));
    const onError = () => finish(new Error('文件传输通道发生错误'));
    const onAbort = () => finish(new DOMException('File transfer cancelled', 'AbortError'));

    try {
      assertActive();
      // Install the threshold before reading bufferedAmount, then recheck after
      // listeners are attached to cover draining during setup.
      releaseThreshold = reserveThreshold(channel, lowWaterMarkBytes);
      if (channel.bufferedAmount <= highWaterMarkBytes) {
        finish();
        return;
      }
      channel.addEventListener('bufferedamountlow', check);
      channel.addEventListener('close', onClose);
      channel.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort);
      timer = setInterval(check, fallbackPollMs);
      check();
    } catch (error) { finish(error); }
  });
}
