import { describe, expect, it } from 'vitest';
import { classifyPeerError, peerSignalingReconnectDelayMs } from './peerErrorPolicy';

describe('peerErrorPolicy', () => {
  it.each(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'])(
    'treats %s as a recoverable signaling error',
    (type) => {
      expect(classifyPeerError(type)).toMatchObject({
        category: 'signaling',
        retryable: true,
      });
    }
  );

  it.each(['peer-unavailable', 'webrtc'])(
    'leaves %s to the connection recovery layer',
    (type) => {
      expect(classifyPeerError(type)).toMatchObject({
        category: 'connection',
        retryable: true,
      });
    }
  );

  it('treats a stable identity collision as user-retryable but blocked', () => {
    expect(classifyPeerError('unavailable-id')).toMatchObject({
      category: 'identity-conflict',
      retryable: true,
    });
  });

  it.each(['browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable', 'unknown'])(
    'treats %s as fatal',
    (type) => {
      expect(classifyPeerError(type)).toMatchObject({
        category: 'fatal',
        retryable: false,
      });
    }
  );

  it('pauses ordinary signaling recovery after six attempts', () => {
    expect(peerSignalingReconnectDelayMs(5, false, () => 0.5)).toBe(15000);
    expect(peerSignalingReconnectDelayMs(6, false, () => 0.5)).toBeNull();
  });

  it('keeps persistent device recovery at the capped interval', () => {
    expect(peerSignalingReconnectDelayMs(6, true, () => 0.5)).toBe(15000);
    expect(peerSignalingReconnectDelayMs(20, true, () => 0.5)).toBe(15000);
  });
});
