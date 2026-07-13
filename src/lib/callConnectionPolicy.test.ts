import { describe, expect, it } from 'vitest';
import {
  dataReconnectDelayMs,
  getDataConnectionChannel,
  isIncomingConnectionMetadataValid,
  isCurrentConnection,
  isPayloadPeerValid,
  isSessionResumePeerValid,
  shouldInitiateOutgoingConnection,
  shouldReplaceCurrentMediaConnection,
  shouldReplaceCurrentDataConnection,
  turnFallbackRoleForSessionRole,
} from './callConnectionPolicy';

describe('callConnectionPolicy', () => {
  it('keeps the host waiting and the guest retrying during TURN fallback', () => {
    expect(turnFallbackRoleForSessionRole('host')).toBe('callee');
    expect(turnFallbackRoleForSessionRole('guest')).toBe('caller');
  });

  it('lets only a guest with a remote peer initiate connections', () => {
    expect(shouldInitiateOutgoingConnection({ role: 'guest', remotePeerId: 'host-peer' })).toBe(true);
    expect(shouldInitiateOutgoingConnection({ role: 'host', remotePeerId: 'guest-peer' })).toBe(false);
    expect(shouldInitiateOutgoingConnection({ role: 'guest', remotePeerId: undefined })).toBe(false);
  });

  it('accepts only opposite-role metadata bound to the active session and transport peer', () => {
    const validMetadata = {
      sessionId: 'session-12345678',
      role: 'guest' as const,
      peerId: 'guest-peer',
    };

    expect(isIncomingConnectionMetadataValid({
      localRole: 'host',
      activeSessionId: 'session-12345678',
      connectionPeer: 'guest-peer',
      metadata: validMetadata,
    })).toBe(true);
    expect(isIncomingConnectionMetadataValid({
      localRole: 'host',
      activeSessionId: 'another-session',
      connectionPeer: 'guest-peer',
      metadata: validMetadata,
    })).toBe(false);
    expect(isIncomingConnectionMetadataValid({
      localRole: 'guest',
      activeSessionId: 'session-12345678',
      connectionPeer: 'guest-peer',
      metadata: validMetadata,
    })).toBe(false);
    expect(isIncomingConnectionMetadataValid({
      localRole: 'host',
      activeSessionId: 'session-12345678',
      connectionPeer: 'transport-peer',
      metadata: validMetadata,
    })).toBe(false);
    expect(isIncomingConnectionMetadataValid({
      localRole: 'host',
      activeSessionId: 'session-12345678',
      connectionPeer: 'guest-peer',
      metadata: { sessionId: 'session-12345678', role: 'guest' },
    })).toBe(false);
  });

  it('guards event handlers so stale connection events cannot mutate current state', () => {
    const current = { id: 'current' };
    const stale = { id: 'stale' };

    expect(isCurrentConnection(current, current)).toBe(true);
    expect(isCurrentConnection(current, stale)).toBe(false);
    expect(isCurrentConnection(null, stale)).toBe(false);
  });

  it('keeps an already-open data connection when a duplicate incoming connection arrives', () => {
    expect(shouldReplaceCurrentDataConnection({ hasCurrentConnection: false, isCurrentOpen: false })).toBe(false);
    expect(shouldReplaceCurrentDataConnection({ hasCurrentConnection: true, isCurrentOpen: true })).toBe(false);
    expect(shouldReplaceCurrentDataConnection({ hasCurrentConnection: true, isCurrentOpen: false })).toBe(true);
  });

  it('replaces media only after the current transport has failed', () => {
    expect(shouldReplaceCurrentMediaConnection({ hasCurrentConnection: false, currentTransportState: '' })).toBe(true);
    expect(shouldReplaceCurrentMediaConnection({ hasCurrentConnection: true, currentTransportState: 'connected' })).toBe(false);
    expect(shouldReplaceCurrentMediaConnection({ hasCurrentConnection: true, currentTransportState: 'failed' })).toBe(true);
    expect(shouldReplaceCurrentMediaConnection({ hasCurrentConnection: true, currentTransportState: 'closed' })).toBe(true);
  });

  it('binds resume and encrypted payload identities to the DataConnection peer', () => {
    expect(isSessionResumePeerValid({
      localRole: 'host',
      activeSessionId: 'session-12345678',
      connectionPeer: 'guest-peer',
      payload: {
        type: 'SESSION_RESUME',
        version: 1,
        sessionId: 'session-12345678',
        peerId: 'guest-peer',
        role: 'guest',
      },
    })).toBe(true);
    expect(isSessionResumePeerValid({
      localRole: 'host',
      activeSessionId: 'session-12345678',
      connectionPeer: 'guest-peer',
      payload: {
        type: 'SESSION_RESUME',
        version: 1,
        sessionId: 'session-12345678',
        peerId: 'forged-peer',
        role: 'guest',
      },
    })).toBe(false);
    expect(isPayloadPeerValid({ from: 'guest-peer' }, 'guest-peer')).toBe(true);
    expect(isPayloadPeerValid({ from: 'forged-peer' }, 'guest-peer')).toBe(false);
  });

  it('classifies only explicit control and bulk data channels', () => {
    expect(getDataConnectionChannel({ channel: 'control' })).toBe('control');
    expect(getDataConnectionChannel({ channel: 'bulk' })).toBe('bulk');
    expect(getDataConnectionChannel({})).toBeNull();
    expect(getDataConnectionChannel({ channel: 'other' })).toBeNull();
  });

  it('limits data reconnect attempts with short exponential backoff', () => {
    expect(dataReconnectDelayMs(0)).toBe(500);
    expect(dataReconnectDelayMs(1)).toBe(1000);
    expect(dataReconnectDelayMs(2)).toBe(2000);
    expect(dataReconnectDelayMs(3)).toBeNull();
  });
});
