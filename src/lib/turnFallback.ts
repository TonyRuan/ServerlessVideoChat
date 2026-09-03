import { isPeerTransportFailed } from './callConnectivity';
import type { TurnMode } from './iceConfig';

export type CallRole = 'caller' | 'callee';
export type TurnFallbackAction = 'none' | 'retry' | 'wait';
export type TurnFallbackStatus =
  | 'idle'
  | 'reconnecting'
  | 'waiting-peer'
  | 'retrying'
  | 'waiting'
  | 'relay-only'
  | 'exhausted'
  | 'active';

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
  if (status === 'reconnecting') return '连接中断，正在自动重连';
  if (status === 'waiting-peer') return '连接中断，等待对方重连';
  if (status === 'retrying') return '连接失败，已启用 TURN 候选并重试';
  if (status === 'waiting') return '连接失败，已启用 TURN 候选，等待对方重连';
  if (status === 'relay-only') return '连接持续失败，正在强制 TURN 中继';
  if (status === 'exhausted') return '自动重连已暂停，请手动重试';
  if (status === 'active') return 'TURN 候选已启用，连接已恢复';
  return '';
}
