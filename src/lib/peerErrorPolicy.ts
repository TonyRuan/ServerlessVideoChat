import { reconnectDelayMs } from './connectionRecovery';

export type PeerErrorCategory =
  | 'signaling'
  | 'connection'
  | 'identity-conflict'
  | 'fatal';

export interface PeerErrorDecision {
  category: PeerErrorCategory;
  message: string;
  retryable: boolean;
}

const SIGNALING_ERRORS = new Set([
  'network',
  'server-error',
  'socket-error',
  'socket-closed',
  'disconnected',
]);

const CONNECTION_ERRORS = new Set([
  'peer-unavailable',
  'webrtc',
]);

export function classifyPeerError(type: string): PeerErrorDecision {
  if (SIGNALING_ERRORS.has(type)) {
    return {
      category: 'signaling',
      message: '信令服务暂时不可用，正在恢复连接。',
      retryable: true,
    };
  }

  if (CONNECTION_ERRORS.has(type)) {
    return {
      category: 'connection',
      message: type === 'peer-unavailable'
        ? '对方暂时不在线，正在等待重新连接。'
        : '本次通话传输出现异常，正在尝试恢复。',
      retryable: true,
    };
  }

  if (type === 'unavailable-id') {
    return {
      category: 'identity-conflict',
      message: '当前连接身份已被其他页面或设备占用。',
      retryable: true,
    };
  }

  const fatalMessages: Record<string, string> = {
    'browser-incompatible': '当前浏览器不支持建立 WebRTC 通话。',
    'invalid-id': '当前连接身份无效，无法加入本次通话。',
    'invalid-key': '信令服务配置无效，请联系站点管理员。',
    'ssl-unavailable': '信令服务的安全连接配置无效。',
  };

  return {
    category: 'fatal',
    message: fatalMessages[type] ?? '连接服务发生了无法自动恢复的错误。',
    retryable: false,
  };
}

export function peerSignalingReconnectDelayMs(
  attempt: number,
  persistentRecovery: boolean,
  random: () => number = Math.random
) {
  if (!persistentRecovery && attempt >= 6) return null;
  return reconnectDelayMs(persistentRecovery ? Math.min(attempt, 5) : attempt, random);
}
