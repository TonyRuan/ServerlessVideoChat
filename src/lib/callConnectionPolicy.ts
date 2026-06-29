import type { CallSessionRole } from './callSession';
import type { CallRole } from './turnFallback';

export function turnFallbackRoleForSessionRole(role: CallSessionRole): CallRole {
  return role === 'guest' ? 'caller' : 'callee';
}

export function shouldAcceptIncomingSessionConnection({ isSameSession }: { isSameSession: boolean }) {
  return isSameSession;
}

export function isCurrentConnection<T>(current: T | null | undefined, candidate: T) {
  return current === candidate;
}

export function dataReconnectDelayMs(attempt: number, maxAttempts = 3) {
  if (attempt >= maxAttempts) return null;
  return 500 * 2 ** attempt;
}
