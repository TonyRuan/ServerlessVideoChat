import { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { type MediaConnection } from 'peerjs';

interface PeerState {
  peer: Peer | null;
  myId: string;
  isPeerReady: boolean;
  error: Error | null;
}

export function usePeer() {
  const [state, setState] = useState<PeerState>({
    peer: null,
    myId: '',
    isPeerReady: false,
    error: null,
  });

  const peerRef = useRef<Peer | null>(null);
  const onCallHandlerRef = useRef<((call: MediaConnection) => void) | null>(null);

  useEffect(() => {
    const peer = new Peer();
    
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

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setState(prev => ({ ...prev, error: err }));
    });

    return () => {
      peer.destroy();
      peerRef.current = null;
    };
  }, []);

  const callPeer = useCallback((peerId: string, stream: MediaStream) => {
    if (!peerRef.current) return null;
    
    const call = peerRef.current.call(peerId, stream);
    return call;
  }, []);

  const onIncomingCall = useCallback((callback: (call: MediaConnection) => void) => {
    onCallHandlerRef.current = callback;
  }, []);

  return {
    ...state,
    callPeer,
    onIncomingCall,
  };
}
