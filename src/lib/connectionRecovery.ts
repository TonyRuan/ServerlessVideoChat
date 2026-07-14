import type { TurnMode } from './iceConfig';

const BASE_RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000] as const;
const MAX_JITTER_RATIO = 0.2;

export interface NextRecoveryTurnModeInput {
  currentTurnMode: TurnMode;
  hasTurnConfig: boolean;
  mediaRecoveryAttempts: number;
}

export function reconnectDelayMs(attempt: number, random: () => number = Math.random) {
  const baseDelayMs = BASE_RECONNECT_DELAYS_MS[attempt];
  if (baseDelayMs === undefined) return null;

  const jitterRatio = (random() * 2 - 1) * MAX_JITTER_RATIO;
  return Math.round(baseDelayMs * (1 + jitterRatio));
}

export function transportRecoveryDelayMs(state: string) {
  if (state === 'new' || state === 'checking' || state === 'connecting') return 15000;
  if (state === 'disconnected') return 5000;
  if (state === 'failed') return 0;
  return null;
}

export function peerTransportRecoveryDelayMs(iceState: string, peerConnectionState: string) {
  const states = [iceState, peerConnectionState];
  if (states.includes('failed')) return 0;
  if (states.includes('disconnected')) return 5000;
  if (states.some((state) => state === 'new' || state === 'checking' || state === 'connecting')) return 15000;
  return null;
}

export function nextRecoveryTurnMode({
  currentTurnMode,
  hasTurnConfig,
  mediaRecoveryAttempts,
}: NextRecoveryTurnModeInput): TurnMode {
  if (!hasTurnConfig || currentTurnMode === 'force') return currentTurnMode;
  if (currentTurnMode === 'off') return 'on';
  if (currentTurnMode === 'on' && mediaRecoveryAttempts > 0) return 'force';
  return currentTurnMode;
}
