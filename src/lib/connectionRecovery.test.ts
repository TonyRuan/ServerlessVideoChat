import { describe, expect, it } from 'vitest';
import {
  nextRecoveryTurnMode,
  peerTransportRecoveryDelayMs,
  reconnectDelayMs,
  transportRecoveryDelayMs,
} from './connectionRecovery';

describe('connectionRecovery', () => {
  it('uses six bounded reconnect delays before giving up', () => {
    expect(reconnectDelayMs(0, () => 0.5)).toBe(500);
    expect(reconnectDelayMs(1, () => 0.5)).toBe(1000);
    expect(reconnectDelayMs(2, () => 0.5)).toBe(2000);
    expect(reconnectDelayMs(3, () => 0.5)).toBe(4000);
    expect(reconnectDelayMs(4, () => 0.5)).toBe(8000);
    expect(reconnectDelayMs(5, () => 0.5)).toBe(15000);
    expect(reconnectDelayMs(6, () => 0.5)).toBeNull();
  });

  it('keeps reconnect jitter within plus or minus twenty percent', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(400);
    expect(reconnectDelayMs(0, () => 1)).toBe(600);
    expect(reconnectDelayMs(5, () => 0)).toBe(12000);
    expect(reconnectDelayMs(5, () => 1)).toBe(18000);
  });

  it('applies transport watchdog timing by transport state', () => {
    expect(transportRecoveryDelayMs('new')).toBe(15000);
    expect(transportRecoveryDelayMs('checking')).toBe(15000);
    expect(transportRecoveryDelayMs('connecting')).toBe(15000);
    expect(transportRecoveryDelayMs('disconnected')).toBe(5000);
    expect(transportRecoveryDelayMs('failed')).toBe(0);
    expect(transportRecoveryDelayMs('connected')).toBeNull();
    expect(transportRecoveryDelayMs('closed')).toBeNull();
  });

  it('uses the most urgent recovery deadline across ICE and peer connection state', () => {
    expect(peerTransportRecoveryDelayMs('checking', 'connecting')).toBe(15000);
    expect(peerTransportRecoveryDelayMs('disconnected', 'connected')).toBe(5000);
    expect(peerTransportRecoveryDelayMs('failed', 'disconnected')).toBe(0);
    expect(peerTransportRecoveryDelayMs('connected', 'connected')).toBeNull();
    expect(peerTransportRecoveryDelayMs('completed', 'connected')).toBeNull();
  });

  it('promotes recovery turn mode only when repeated media failures justify it', () => {
    expect(nextRecoveryTurnMode({
      currentTurnMode: 'off',
      hasTurnConfig: true,
      mediaRecoveryAttempts: 0,
    })).toBe('on');

    expect(nextRecoveryTurnMode({
      currentTurnMode: 'on',
      hasTurnConfig: true,
      mediaRecoveryAttempts: 0,
    })).toBe('on');

    expect(nextRecoveryTurnMode({
      currentTurnMode: 'on',
      hasTurnConfig: true,
      mediaRecoveryAttempts: 1,
    })).toBe('force');

    expect(nextRecoveryTurnMode({
      currentTurnMode: 'on',
      hasTurnConfig: false,
      mediaRecoveryAttempts: 3,
    })).toBe('on');

    expect(nextRecoveryTurnMode({
      currentTurnMode: 'force',
      hasTurnConfig: true,
      mediaRecoveryAttempts: 5,
    })).toBe('force');
  });
});
