import { describe, expect, it } from 'vitest';
import { buildPeerRtcConfig, buildPeerRtcConfigForMode, hasConfiguredTurnServers, resolveTurnMode } from './iceConfig';

const envWithTurn = {
  VITE_TURN_URLS: 'turn:turn.example.com:3478?transport=udp, turn:turn.example.com:3478?transport=tcp',
  VITE_TURN_USERNAME: 'user',
  VITE_TURN_CREDENTIAL: 'pass',
};

describe('iceConfig', () => {
  it('enables TURN by default when TURN credentials are configured', () => {
    const config = buildPeerRtcConfig(envWithTurn, '');

    expect(config.iceTransportPolicy).toBeUndefined();
    expect(config.iceServers?.some((server) => Array.isArray(server.urls))).toBe(true);
    expect(config.iceServers?.some((server) => String(server.urls).startsWith('stun:'))).toBe(true);
  });

  it('keeps TURN disabled when the session URL requests it', () => {
    const config = buildPeerRtcConfig(envWithTurn, '?turn=0');

    expect(config.iceTransportPolicy).toBeUndefined();
    expect(config.iceServers?.some((server) => Array.isArray(server.urls))).toBe(false);
    expect(config.iceServers?.some((server) => String(server.urls).startsWith('stun:'))).toBe(true);
  });

  it('includes TURN when the session URL requests it', () => {
    const config = buildPeerRtcConfig(envWithTurn, '?turn=1');

    const turnServer = config.iceServers?.find((server) => Array.isArray(server.urls));
    expect(turnServer).toEqual({
      urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'],
      username: 'user',
      credential: 'pass',
    });
    expect(config.iceTransportPolicy).toBeUndefined();
  });

  it('supports relay-only mode for explicit TURN diagnostics', () => {
    const config = buildPeerRtcConfig(envWithTurn, '#turn=force');

    expect(config.iceServers?.some((server) => Array.isArray(server.urls))).toBe(true);
    expect(config.iceTransportPolicy).toBe('relay');
  });

  it('keeps relay-only policy visible even when TURN URLs are missing', () => {
    const config = buildPeerRtcConfig({}, '#turn=force');

    expect(config.iceTransportPolicy).toBe('relay');
    expect(config.iceServers?.some((server) => Array.isArray(server.urls))).toBe(false);
  });

  it('lets the URL override an environment default that enables TURN', () => {
    expect(resolveTurnMode({ VITE_TURN_MODE: 'on' }, '?turn=0')).toBe('off');
    expect(resolveTurnMode({ VITE_TURN_MODE: 'off' }, '?turn=1')).toBe('on');
  });

  it('builds TURN-enabled config for automatic fallback without changing the location token', () => {
    const config = buildPeerRtcConfigForMode(envWithTurn, 'on');

    expect(config.iceTransportPolicy).toBeUndefined();
    expect(config.iceServers?.some((server) => Array.isArray(server.urls))).toBe(true);
  });

  it('detects whether TURN credentials can be used for fallback', () => {
    expect(hasConfiguredTurnServers(envWithTurn)).toBe(true);
    expect(hasConfiguredTurnServers({ VITE_TURN_URLS: '' })).toBe(false);
    expect(hasConfiguredTurnServers({ VITE_TURN_URLS: 'turn:turn.example.com:3478' })).toBe(false);
    expect(hasConfiguredTurnServers({ VITE_TURN_URLS: 'turn:turn.example.com:3478', VITE_TURN_USERNAME: 'user' })).toBe(
      false
    );
    expect(
      hasConfiguredTurnServers({ VITE_TURN_URLS: 'turn:turn.example.com:3478', VITE_TURN_CREDENTIAL: 'pass' })
    ).toBe(false);
  });
});
