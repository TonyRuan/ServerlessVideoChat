import { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { type MediaConnection, type DataConnection } from 'peerjs';

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
  const onDataHandlerRef = useRef<((conn: DataConnection) => void) | null>(null);

  useEffect(() => {
    const baseIceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ];

    const turnUrls = (import.meta.env.VITE_TURN_URLS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

    const iceServers: RTCIceServer[] = [...baseIceServers];
    if (turnUrls.length > 0) {
      if (turnUsername && turnCredential) {
        iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
      } else {
        iceServers.push({ urls: turnUrls });
      }
    }

    const peer = new Peer(undefined, {
      config: {
        iceServers,
      },
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

  const callPeer = useCallback((peerId: string, stream: MediaStream) => {
    if (!peerRef.current) return null;
    
    const call = peerRef.current.call(peerId, stream);
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
  };
}
