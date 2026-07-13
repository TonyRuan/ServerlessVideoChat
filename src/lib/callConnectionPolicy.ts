import type { CallSessionRole } from './callSession';
import type { CallRole } from './turnFallback';

export type DataConnectionChannel = 'control' | 'bulk';

export function getDataConnectionChannel(metadata: unknown): DataConnectionChannel | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const channel = (metadata as Record<string, unknown>).channel;
  return channel === 'control' || channel === 'bulk' ? channel : null;
}

export function turnFallbackRoleForSessionRole(role: CallSessionRole): CallRole {
  return role === 'guest' ? 'caller' : 'callee';
}

export function shouldInitiateOutgoingConnection({
  role,
  remotePeerId,
}: {
  role: CallSessionRole;
  remotePeerId?: string;
}) {
  return role === 'guest' && Boolean(remotePeerId);
}

export function isIncomingConnectionMetadataValid({
  localRole,
  activeSessionId,
  connectionPeer,
  metadata,
}: {
  localRole: CallSessionRole;
  activeSessionId: string;
  connectionPeer: string;
  metadata: unknown;
}) {
  if (localRole !== 'host' || typeof metadata !== 'object' || metadata === null) return false;

  const record = metadata as Record<string, unknown>;
  return (
    record.sessionId === activeSessionId &&
    record.role === 'guest' &&
    typeof record.peerId === 'string' &&
    record.peerId === connectionPeer
  );
}

export function isCurrentConnection<T>(current: T | null | undefined, candidate: T) {
  return current === candidate;
}

export function shouldReplaceCurrentMediaConnection({
  hasCurrentConnection,
  currentTransportState,
}: {
  hasCurrentConnection: boolean;
  currentTransportState: string;
}) {
  return !hasCurrentConnection || ['closed', 'disconnected', 'failed'].includes(currentTransportState);
}

export function isSessionResumePeerValid({
  localRole,
  activeSessionId,
  connectionPeer,
  payload,
}: {
  localRole: CallSessionRole;
  activeSessionId: string;
  connectionPeer: string;
  payload: {
    sessionId: string;
    peerId: string;
    role: CallSessionRole;
    type?: string;
    version?: number;
  };
}) {
  const expectedRemoteRole: CallSessionRole = localRole === 'host' ? 'guest' : 'host';
  return (
    payload.sessionId === activeSessionId &&
    payload.peerId === connectionPeer &&
    payload.role === expectedRemoteRole
  );
}

export function isPayloadPeerValid(payload: { from: string }, connectionPeer: string) {
  return payload.from === connectionPeer;
}

export function shouldReplaceCurrentDataConnection({
  hasCurrentConnection,
  isCurrentOpen,
}: {
  hasCurrentConnection: boolean;
  isCurrentOpen: boolean;
}) {
  return hasCurrentConnection && !isCurrentOpen;
}

export function dataReconnectDelayMs(attempt: number, maxAttempts = 3) {
  if (attempt >= maxAttempts) return null;
  return 500 * 2 ** attempt;
}
