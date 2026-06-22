import { describe, expect, it } from 'vitest';
import { deriveTurnFallbackAction } from './turnFallback';

describe('turnFallback', () => {
  it('asks the caller to retry with TURN after direct transport failure', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('retry');
  });

  it('asks the callee to wait for the caller after enabling TURN fallback', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'callee',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'connecting',
      })
    ).toBe('wait');
  });

  it('does not retry when TURN is unavailable, already enabled, or already attempted', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: false,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('none');

    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'on',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('none');

    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: true,
        iceState: 'failed',
        peerConnectionState: 'failed',
      })
    ).toBe('none');
  });

  it('does not retry for transient non-failed transport states', () => {
    expect(
      deriveTurnFallbackAction({
        role: 'caller',
        turnMode: 'off',
        hasTurnConfig: true,
        attempted: false,
        iceState: 'disconnected',
        peerConnectionState: 'connecting',
      })
    ).toBe('none');
  });
});
