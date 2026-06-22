import { describe, expect, it } from 'vitest';
import { getCallConnectionIssue, getEffectiveConnectionStatus } from './callConnectivity';

describe('callConnectivity', () => {
  it('treats a failed peer connection as disconnected even after a stream event', () => {
    expect(getEffectiveConnectionStatus('connected', 'disconnected', 'failed')).toBe('disconnected');
    expect(getEffectiveConnectionStatus('connected', 'failed', 'connecting')).toBe('disconnected');
  });

  it('keeps the original status when the peer connection has not failed', () => {
    expect(getEffectiveConnectionStatus('connected', 'connected', 'connected')).toBe('connected');
    expect(getEffectiveConnectionStatus('waiting', '', '')).toBe('waiting');
  });

  it('explains why remote tracks exist but video and chat are unavailable', () => {
    expect(getCallConnectionIssue('failed', 'failed', true)).toBe(
      '当前网络直连失败。已收到对方媒体轨道，但没有可用的 WebRTC 传输；视频和图文聊天都需要 TURN 中继。'
    );
  });

  it('does not show a transport issue for normal connected states', () => {
    expect(getCallConnectionIssue('connected', 'connected', true)).toBeNull();
  });
});
