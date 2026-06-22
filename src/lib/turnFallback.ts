import { isPeerTransportFailed } from './callConnectivity';
import type { TurnMode } from './iceConfig';

export type CallRole = 'caller' | 'callee';
export type TurnFallbackAction = 'none' | 'retry' | 'wait';
export type TurnFallbackStatus = 'idle' | 'retrying' | 'waiting' | 'active';

export interface TurnFallbackInput {
  role: CallRole;
  turnMode: TurnMode;
  hasTurnConfig: boolean;
  attempted: boolean;
  iceState: string;
  peerConnectionState: string;
}

export function deriveTurnFallbackAction({
  role,
  turnMode,
  hasTurnConfig,
  attempted,
  iceState,
  peerConnectionState,
}: TurnFallbackInput): TurnFallbackAction {
  if (!hasTurnConfig || attempted || turnMode !== 'off') return 'none';
  if (!isPeerTransportFailed(iceState, peerConnectionState)) return 'none';
  return role === 'caller' ? 'retry' : 'wait';
}

export function turnFallbackStatusLabel(status: TurnFallbackStatus) {
  if (status === 'retrying') return '直连失败，正在自动切换 TURN';
  if (status === 'waiting') return '直连失败，已启用 TURN，等待对方重连';
  if (status === 'active') return '已自动切换 TURN';
  return '';
}
