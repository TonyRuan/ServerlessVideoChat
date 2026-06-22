import { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { type MediaConnection, type DataConnection } from 'peerjs';
import { preferVideoCodecsInSdp } from '../lib/videoCodecPreference';
import {
  buildPeerRtcConfigForMode,
  hasConfiguredTurnServers,
  resolveTurnMode,
  type IceConfigEnvironment,
  type TurnMode,
} from '../lib/iceConfig';

interface PeerState {
  peer: Peer | null;
  myId: string;
  isPeerReady: boolean;
  error: Error | null;
}

type PeerWithMutableOptions = Peer & {
  options?: {
    config?: RTCConfiguration;
  };
};

const getIceConfigEnvironment = (): IceConfigEnvironment => ({
  VITE_TURN_URLS: import.meta.env.VITE_TURN_URLS,
  VITE_TURN_USERNAME: import.meta.env.VITE_TURN_USERNAME,
  VITE_TURN_CREDENTIAL: import.meta.env.VITE_TURN_CREDENTIAL,
  VITE_TURN_MODE: import.meta.env.VITE_TURN_MODE,
});

export function usePeer() {
  const iceConfigEnvironmentRef = useRef<IceConfigEnvironment>(getIceConfigEnvironment());
  const [state, setState] = useState<PeerState>({
    peer: null,
    myId: '',
    isPeerReady: false,
    error: null,
  });
  const [turnMode, setTurnMode] = useState<TurnMode>(() => resolveTurnMode(iceConfigEnvironmentRef.current));

  const peerRef = useRef<Peer | null>(null);
  const onCallHandlerRef = useRef<((call: MediaConnection) => void) | null>(null);
  const onDataHandlerRef = useRef<((conn: DataConnection) => void) | null>(null);

  const applyTurnModeToPeer = useCallback((mode: TurnMode) => {
    const peer = peerRef.current as PeerWithMutableOptions | null;
    if (peer?.options) {
      peer.options.config = buildPeerRtcConfigForMode(iceConfigEnvironmentRef.current, mode);
    }
    setTurnMode(mode);
  }, []);

  useEffect(() => {
    const initialTurnMode = resolveTurnMode(iceConfigEnvironmentRef.current);
    const peer = new Peer(undefined, {
      config: buildPeerRtcConfigForMode(iceConfigEnvironmentRef.current, initialTurnMode),
    });
    
    peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      setState(prev => ({ ...prev, myId: id, isPeerReady: true, peer }));
      peerRef.current = peer;
    });

    peer.on('call', (call) => {
      if (onCallHandlerRef.current) {
        onCallHandlerRef.current(call);
      }
    });

    peer.on('connection', (conn) => {
      if (onDataHandlerRef.current) {
        onDataHandlerRef.current(conn);
      }
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setState(prev => ({ ...prev, error: err }));
    });

    return () => {
      peer.destroy();
      peerRef.current = null;
    };
  }, []);

  const enableTurnFallback = useCallback(() => {
    if (!hasConfiguredTurnServers(iceConfigEnvironmentRef.current) || turnMode !== 'off') return false;
    applyTurnModeToPeer('on');
    return true;
  }, [applyTurnModeToPeer, turnMode]);

  const callPeer = useCallback((peerId: string, stream: MediaStream) => {
    if (!peerRef.current) return null;
    
    const call = peerRef.current.call(peerId, stream, {
      sdpTransform: preferVideoCodecsInSdp,
    });
    return call;
  }, []);

  const connectToPeer = useCallback((peerId: string) => {
    if (!peerRef.current) return null;
    
    const conn = peerRef.current.connect(peerId);
    return conn;
  }, []);

  const onIncomingCall = useCallback((callback: (call: MediaConnection) => void) => {
    onCallHandlerRef.current = callback;
  }, []);

  const onIncomingData = useCallback((callback: (conn: DataConnection) => void) => {
    onDataHandlerRef.current = callback;
  }, []);

  return {
    ...state,
    callPeer,
    connectToPeer,
    onIncomingCall,
    onIncomingData,
    turnMode,
    hasTurnConfig: hasConfiguredTurnServers(iceConfigEnvironmentRef.current),
    enableTurnFallback,
  };
}
