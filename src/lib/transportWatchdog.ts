import { peerTransportRecoveryDelayMs } from './connectionRecovery';

interface PeerTransportLike {
  iceConnectionState: string;
  connectionState: string;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export function watchPeerTransport(transport: PeerTransportLike, onRecovery: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline: number | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    deadline = null;
  };

  const update = () => {
    const delayMs = peerTransportRecoveryDelayMs(
      transport.iceConnectionState,
      transport.connectionState
    );
    if (delayMs === null) {
      clear();
      return;
    }

    const nextDeadline = Date.now() + delayMs;
    if (timer && deadline !== null && deadline <= nextDeadline) return;

    clear();
    deadline = nextDeadline;
    timer = setTimeout(() => {
      timer = null;
      deadline = null;
      if (peerTransportRecoveryDelayMs(transport.iceConnectionState, transport.connectionState) !== null) {
        onRecovery();
      }
    }, Math.max(0, nextDeadline - Date.now()));
  };

  transport.addEventListener('iceconnectionstatechange', update);
  transport.addEventListener('connectionstatechange', update);
  update();

  return () => {
    clear();
    transport.removeEventListener('iceconnectionstatechange', update);
    transport.removeEventListener('connectionstatechange', update);
  };
}
