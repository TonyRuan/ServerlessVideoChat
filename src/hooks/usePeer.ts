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
import {
  loadTurnCredentials,
  resolveTurnCredentialEnvironment,
  turnCredentialRefreshDelayMs,
  turnCredentialRetryDelayMs,
  type TurnCredentials,
} from '../lib/turnCredentials';
import {
  createDataConnectionOptions,
  type DataConnectionChannel,
} from '../lib/dataConnectionPayload';
import type { CallSessionRole } from '../lib/callSession';

interface PeerState {
  peer: Peer | null;
  myId: string;
  isPeerReady: boolean;
  error: Error | null;
}

export type TurnCredentialSource = 'loading' | 'dynamic' | 'static' | 'unavailable';

type PeerWithMutableOptions = Peer & {
  options?: {
    config?: RTCConfiguration;
  };
};

export interface PeerConnectionMetadata {
  sessionId: string;
  role: CallSessionRole;
  turnMode?: TurnMode;
  peerId?: string;
  channel?: DataConnectionChannel;
}

const getIceConfigEnvironment = (): IceConfigEnvironment => ({
  VITE_TURN_URLS: import.meta.env.VITE_TURN_URLS,
  VITE_TURN_USERNAME: import.meta.env.VITE_TURN_USERNAME,
  VITE_TURN_CREDENTIAL: import.meta.env.VITE_TURN_CREDENTIAL,
  VITE_TURN_MODE: import.meta.env.VITE_TURN_MODE,
  VITE_TURN_CREDENTIALS_URL: import.meta.env.VITE_TURN_CREDENTIALS_URL,
});

export function usePeer() {
  const staticIceConfigEnvironmentRef = useRef<IceConfigEnvironment>(getIceConfigEnvironment());
  const iceConfigEnvironmentRef = useRef<IceConfigEnvironment>(staticIceConfigEnvironmentRef.current);
  const [state, setState] = useState<PeerState>({
    peer: null,
    myId: '',
    isPeerReady: false,
    error: null,
  });
  const initialTurnMode = resolveTurnMode(staticIceConfigEnvironmentRef.current);
  const [turnMode, setTurnMode] = useState<TurnMode>(initialTurnMode);
  const [hasTurnConfig, setHasTurnConfig] = useState(() => hasConfiguredTurnServers(iceConfigEnvironmentRef.current));
  const [turnCredentialSource, setTurnCredentialSource] = useState<TurnCredentialSource>('loading');
  const [turnCredentialExpiresAt, setTurnCredentialExpiresAt] = useState<number | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const turnModeRef = useRef<TurnMode>(initialTurnMode);
  const credentialRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCallHandlerRef = useRef<((call: MediaConnection) => void) | null>(null);
  const onDataHandlerRef = useRef<((conn: DataConnection) => void) | null>(null);

  const applyTurnModeToPeer = useCallback((mode: TurnMode) => {
    turnModeRef.current = mode;
    const peer = peerRef.current as PeerWithMutableOptions | null;
    if (peer?.options) {
      peer.options.config = buildPeerRtcConfigForMode(iceConfigEnvironmentRef.current, mode);
    }
    setTurnMode(mode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let activeCredentials: TurnCredentials | null = null;

    const applyCredentials = (credentials: TurnCredentials | null) => {
      activeCredentials = credentials;
      const environment = resolveTurnCredentialEnvironment(staticIceConfigEnvironmentRef.current, credentials);
      iceConfigEnvironmentRef.current = environment;

      const configured = hasConfiguredTurnServers(environment);
      setHasTurnConfig(configured);
      setTurnCredentialSource(credentials
        ? 'dynamic'
        : hasConfiguredTurnServers(staticIceConfigEnvironmentRef.current)
          ? 'static'
          : 'unavailable');
      setTurnCredentialExpiresAt(credentials?.expiresAt ?? null);

      const peer = peerRef.current as PeerWithMutableOptions | null;
      if (peer?.options) {
        peer.options.config = buildPeerRtcConfigForMode(environment, turnModeRef.current);
      }
    };

    const scheduleCredentialLoad = (delayMs: number) => {
      if (credentialRefreshTimerRef.current) clearTimeout(credentialRefreshTimerRef.current);
      credentialRefreshTimerRef.current = setTimeout(() => {
        credentialRefreshTimerRef.current = null;
        void refreshCredentials();
      }, delayMs);
    };

    const refreshCredentials = async () => {
      const credentials = await loadTurnCredentials({
        endpoint: staticIceConfigEnvironmentRef.current.VITE_TURN_CREDENTIALS_URL,
      });
      if (cancelled) return;

      if (credentials) {
        applyCredentials(credentials);
        scheduleCredentialLoad(turnCredentialRefreshDelayMs(credentials));
        return;
      }

      const hadDynamicCredentials = activeCredentials !== null;
      if (activeCredentials && activeCredentials.expiresAt <= Date.now()) {
        applyCredentials(null);
      }
      scheduleCredentialLoad(turnCredentialRetryDelayMs({
        hasStaticFallback: hasConfiguredTurnServers(staticIceConfigEnvironmentRef.current),
        hadDynamicCredentials,
      }));
    };

    const initialize = async () => {
      const credentials = await loadTurnCredentials({
        endpoint: staticIceConfigEnvironmentRef.current.VITE_TURN_CREDENTIALS_URL,
      });
      if (cancelled) return;
      applyCredentials(credentials);
      if (credentials) {
        scheduleCredentialLoad(turnCredentialRefreshDelayMs(credentials));
      } else {
        scheduleCredentialLoad(turnCredentialRetryDelayMs({
          hasStaticFallback: hasConfiguredTurnServers(staticIceConfigEnvironmentRef.current),
          hadDynamicCredentials: false,
        }));
      }

      const peer = new Peer(undefined, {
        config: buildPeerRtcConfigForMode(iceConfigEnvironmentRef.current, turnModeRef.current),
      });
      peerRef.current = peer;

      peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        setState(prev => ({ ...prev, myId: id, isPeerReady: true, peer }));
      });

      peer.on('call', (call) => {
        onCallHandlerRef.current?.(call);
      });

      peer.on('connection', (conn) => {
        onDataHandlerRef.current?.(conn);
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        setState(prev => ({ ...prev, error: err }));
      });
    };

    void initialize();

    return () => {
      cancelled = true;
      if (credentialRefreshTimerRef.current) {
        clearTimeout(credentialRefreshTimerRef.current);
        credentialRefreshTimerRef.current = null;
      }
      peerRef.current?.destroy();
      peerRef.current = null;
    };
  }, []);

  const enableTurnFallback = useCallback(() => {
    if (!hasConfiguredTurnServers(iceConfigEnvironmentRef.current) || turnModeRef.current !== 'off') return false;
    applyTurnModeToPeer('on');
    return true;
  }, [applyTurnModeToPeer]);

  const applyTurnMode = useCallback((mode: TurnMode) => {
    if (mode !== 'off' && !hasConfiguredTurnServers(iceConfigEnvironmentRef.current)) return false;
    applyTurnModeToPeer(mode);
    return true;
  }, [applyTurnModeToPeer]);

  const callPeer = useCallback((peerId: string, stream: MediaStream, metadata?: PeerConnectionMetadata) => {
    if (!peerRef.current) return null;

    const call = peerRef.current.call(peerId, stream, {
      metadata,
      sdpTransform: preferVideoCodecsInSdp,
    });
    return call;
  }, []);

  const connectToPeer = useCallback((
    peerId: string,
    metadata?: PeerConnectionMetadata,
    channel: DataConnectionChannel = 'control'
  ) => {
    if (!peerRef.current) return null;

    const conn = peerRef.current.connect(peerId, {
      ...createDataConnectionOptions(channel),
      metadata: {
        ...metadata,
        channel,
      },
    });
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
    hasTurnConfig,
    enableTurnFallback,
    applyTurnMode,
    turnCredentialSource,
    turnCredentialExpiresAt,
  };
}
