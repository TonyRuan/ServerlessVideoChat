import { describe, expect, it } from 'vitest';
import {
  dataReconnectDelayMs,
  isCurrentConnection,
  shouldAcceptIncomingSessionConnection,
  turnFallbackRoleForSessionRole,
} from './callConnectionPolicy';

describe('callConnectionPolicy', () => {
  it('keeps the host waiting and the guest retrying during TURN fallback', () => {
    expect(turnFallbackRoleForSessionRole('host')).toBe('callee');
    expect(turnFallbackRoleForSessionRole('guest')).toBe('caller');
  });

  it('rejects incoming PeerJS connections that do not match the active session', () => {
    expect(shouldAcceptIncomingSessionConnection({ isSameSession: true })).toBe(true);
    expect(shouldAcceptIncomingSessionConnection({ isSameSession: false })).toBe(false);
  });

  it('guards event handlers so stale connection events cannot mutate current state', () => {
    const current = { id: 'current' };
    const stale = { id: 'stale' };

    expect(isCurrentConnection(current, current)).toBe(true);
    expect(isCurrentConnection(current, stale)).toBe(false);
    expect(isCurrentConnection(null, stale)).toBe(false);
  });

  it('limits data reconnect attempts with short exponential backoff', () => {
    expect(dataReconnectDelayMs(0)).toBe(500);
    expect(dataReconnectDelayMs(1)).toBe(1000);
    expect(dataReconnectDelayMs(2)).toBe(2000);
    expect(dataReconnectDelayMs(3)).toBeNull();
  });
});
