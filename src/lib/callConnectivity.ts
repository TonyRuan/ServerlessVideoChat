export type CallConnectionStatus =
  | 'initializing'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'disconnected';

const FAILED_STATES = new Set(['failed']);
const ENDED_STATES = new Set(['failed', 'closed']);

export function isPeerTransportFailed(iceState: string, peerConnectionState: string) {
  return FAILED_STATES.has(iceState) || FAILED_STATES.has(peerConnectionState);
}

function isPeerTransportEnded(iceState: string, peerConnectionState: string) {
  return ENDED_STATES.has(iceState) || ENDED_STATES.has(peerConnectionState);
}

export function getEffectiveConnectionStatus(
  status: CallConnectionStatus,
  iceState: string,
  peerConnectionState: string
): CallConnectionStatus {
  if (isPeerTransportEnded(iceState, peerConnectionState)) {
    return 'disconnected';
  }

  return status;
}

export function getCallConnectionIssue(
  iceState: string,
  peerConnectionState: string,
  hasRemoteStream: boolean
) {
  if (!hasRemoteStream || !isPeerTransportFailed(iceState, peerConnectionState)) {
    return null;
  }

  return '当前网络直连失败。已收到对方媒体轨道，但没有可用的 WebRTC 传输；视频和图文聊天都需要 TURN 中继。';
}
