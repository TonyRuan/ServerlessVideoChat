import { describe, expect, it } from 'vitest';
import { getCallConnectionIssue, getEffectiveConnectionStatus, isPeerTransportFailed } from './callConnectivity';

describe('callConnectivity', () => {
  it('treats a failed peer connection as disconnected even after a stream event', () => {
    expect(getEffectiveConnectionStatus('connected', 'disconnected', 'failed')).toBe('disconnected');
    expect(getEffectiveConnectionStatus('connected', 'failed', 'connecting')).toBe('disconnected');
  });

  it('keeps the original status when the peer connection has not failed', () => {
    expect(getEffectiveConnectionStatus('connected', 'connected', 'connected')).toBe('connected');
    expect(getEffectiveConnectionStatus('waiting', '', '')).toBe('waiting');
  });

  it('treats closed transport as disconnected without making it a TURN fallback failure', () => {
    expect(isPeerTransportFailed('closed', 'closed')).toBe(false);
    expect(getEffectiveConnectionStatus('connected', 'closed', 'closed')).toBe('disconnected');
  });

  it('explains why remote tracks exist but video and chat are unavailable', () => {
    expect(getCallConnectionIssue('failed', 'failed', true)).toBe(
      'WebRTC 传输已失败。已收到对方媒体轨道，但当前没有可用链路；请检查网络或 TURN 中继。'
    );
  });

  it('does not show a transport issue for normal connected states', () => {
    expect(getCallConnectionIssue('connected', 'connected', true)).toBeNull();
  });
});
