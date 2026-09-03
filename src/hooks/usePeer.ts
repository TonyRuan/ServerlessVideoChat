import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
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
import { resolvePublicAppBaseUrl, resolveTurnCredentialsEndpoint } from '../lib/runtimeUrls';
import {
  classifyPeerError,
  peerSignalingReconnectDelayMs,
  type PeerErrorCategory,
} from '../lib/peerErrorPolicy';

export type PeerStatus =
  | 'initializing'
  | 'ready'
  | 'reconnecting'
  | 'offline'
  | 'retry-paused'
  | 'blocked'
  | 'fatal';

export interface PeerIssue {
  type: string;
  category: PeerErrorCategory;
  message: string;
  detail: string;
  retryable: boolean;
}

export interface PeerConnectionIssue extends PeerIssue {
  id: number;
}

interface UsePeerOptions {
  persistentRecovery?: boolean;
  allowIdentityReplacement?: boolean;
}

interface PeerState {
  peer: Peer | null;
  myId: string;
  isPeerReady: boolean;
  status: PeerStatus;
  issue: PeerIssue | null;
  connectionIssue: PeerConnectionIssue | null;
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

const getIceConfigEnvironment = (): IceConfigEnvironment => {
  const isNative = Capacitor.isNativePlatform();
  const publicAppBaseUrl = resolvePublicAppBaseUrl({
    configuredUrl: import.meta.env.VITE_PUBLIC_APP_URL,
    isNative,
    origin: window.location.origin,
    basePath: import.meta.env.BASE_URL,
  });

  return {
    VITE_TURN_URLS: import.meta.env.VITE_TURN_URLS,
    VITE_TURN_USERNAME: import.meta.env.VITE_TURN_USERNAME,
    VITE_TURN_CREDENTIAL: import.meta.env.VITE_TURN_CREDENTIAL,
    VITE_TURN_MODE: import.meta.env.VITE_TURN_MODE,
    VITE_TURN_CREDENTIALS_URL: resolveTurnCredentialsEndpoint({
      configuredEndpoint: import.meta.env.VITE_TURN_CREDENTIALS_URL,
      isNative,
      publicAppBaseUrl,
    }),
  };
};

export function usePeer(
  preferredPeerId?: string,
  {
    persistentRecovery = false,
    allowIdentityReplacement = false,
  }: UsePeerOptions = {}
) {
  const staticIceConfigEnvironmentRef = useRef<IceConfigEnvironment>(getIceConfigEnvironment());
  const iceConfigEnvironmentRef = useRef<IceConfigEnvironment>(staticIceConfigEnvironmentRef.current);
  const [state, setState] = useState<PeerState>({
    peer: null,
    myId: '',
    isPeerReady: false,
    status: 'initializing',
    issue: null,
    connectionIssue: null,
  });
  const initialTurnMode = resolveTurnMode(staticIceConfigEnvironmentRef.current);
  const [turnMode, setTurnMode] = useState<TurnMode>(initialTurnMode);
  const [hasTurnConfig, setHasTurnConfig] = useState(() => hasConfiguredTurnServers(iceConfigEnvironmentRef.current));
  const [turnCredentialSource, setTurnCredentialSource] = useState<TurnCredentialSource>('loading');
  const [turnCredentialExpiresAt, setTurnCredentialExpiresAt] = useState<number | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const turnModeRef = useRef<TurnMode>(initialTurnMode);
  const credentialRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerRecoveryAttemptRef = useRef(0);
  const peerGenerationRef = useRef(0);
  const connectionIssueIdRef = useRef(0);
  const retryPeerRef = useRef<() => void>(() => undefined);
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
    let recoveryBlocked = false;
    let replaceIdentityOnRecovery = false;

    const clearPeerRecoveryTimer = () => {
      if (!peerRecoveryTimerRef.current) return;
      clearTimeout(peerRecoveryTimerRef.current);
      peerRecoveryTimerRef.current = null;
    };

    const isBrowserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

    const toPeerIssue = (error: Error & { type?: string }): PeerIssue => {
      const type = typeof error.type === 'string' ? error.type : 'unknown';
      const decision = classifyPeerError(type);
      return {
        type,
        category: decision.category,
        message: decision.message,
        detail: error.message,
        retryable: decision.retryable,
      };
    };

    function markPeerReady(peer: Peer, id: string) {
      recoveryBlocked = false;
      replaceIdentityOnRecovery = false;
      peerRecoveryAttemptRef.current = 0;
      clearPeerRecoveryTimer();
      setState((prev) => ({
        ...prev,
        peer,
        myId: id,
        isPeerReady: true,
        status: 'ready',
        issue: null,
      }));
    }

    function schedulePeerRecovery(immediate = false) {
      if (cancelled || recoveryBlocked || peerRecoveryTimerRef.current) return;

      if (isBrowserOffline()) {
        setState((prev) => ({
          ...prev,
          isPeerReady: false,
          status: 'offline',
          issue: prev.issue ?? {
            type: 'offline',
            category: 'signaling',
            message: '当前设备处于离线状态，网络恢复后将自动重新连接。',
            detail: 'navigator.onLine is false',
            retryable: true,
          },
        }));
        return;
      }

      const attempt = peerRecoveryAttemptRef.current;
      const delayMs = immediate
        ? 0
        : peerSignalingReconnectDelayMs(attempt, persistentRecovery);
      if (delayMs === null) {
        setState((prev) => ({
          ...prev,
          isPeerReady: false,
          status: 'retry-paused',
          issue: prev.issue ?? {
            type: 'network',
            category: 'signaling',
            message: '信令服务仍不可用，自动重连已暂停。',
            detail: 'Signaling recovery attempts exhausted',
            retryable: true,
          },
        }));
        return;
      }

      peerRecoveryAttemptRef.current += 1;
      setState((prev) => ({
        ...prev,
        isPeerReady: false,
        status: 'reconnecting',
      }));
      peerRecoveryTimerRef.current = setTimeout(() => {
        peerRecoveryTimerRef.current = null;
        recoverPeer();
      }, delayMs);
    }

    function recoverPeer() {
      if (cancelled || recoveryBlocked) return;
      if (isBrowserOffline()) {
        schedulePeerRecovery();
        return;
      }

      const peer = peerRef.current;
      if (replaceIdentityOnRecovery || !peer || peer.destroyed) {
        replaceIdentityOnRecovery = false;
        createPeer(true);
        return;
      }

      if (peer.open && !peer.disconnected) {
        markPeerReady(peer, peer.id);
        return;
      }

      try {
        if (peer.disconnected) peer.reconnect();
      } catch (error) {
        console.error('PeerJS reconnect failed:', error);
      }
      schedulePeerRecovery();
    }

    function createPeer(replaceExisting = false) {
      if (cancelled || recoveryBlocked) return;

      const generation = peerGenerationRef.current + 1;
      peerGenerationRef.current = generation;
      const previousPeer = peerRef.current;
      peerRef.current = null;
      if (replaceExisting && previousPeer && !previousPeer.destroyed) previousPeer.destroy();

      const peerOptions = {
        config: buildPeerRtcConfigForMode(iceConfigEnvironmentRef.current, turnModeRef.current),
      };
      const peer = preferredPeerId
        ? new Peer(preferredPeerId, peerOptions)
        : new Peer(peerOptions);
      peerRef.current = peer;
      setState((prev) => ({
        ...prev,
        peer,
        myId: replaceExisting ? '' : prev.myId,
        isPeerReady: false,
        status: prev.myId ? 'reconnecting' : 'initializing',
      }));

      const isCurrent = () => !cancelled && peerGenerationRef.current === generation && peerRef.current === peer;

      peer.on('open', (id) => {
        if (!isCurrent()) return;
        console.log('My peer ID is: ' + id);
        markPeerReady(peer, id);
      });

      peer.on('call', (call) => {
        if (isCurrent()) onCallHandlerRef.current?.(call);
      });

      peer.on('connection', (conn) => {
        if (isCurrent()) onDataHandlerRef.current?.(conn);
      });

      peer.on('disconnected', () => {
        if (!isCurrent() || recoveryBlocked) return;
        setState((prev) => ({
          ...prev,
          isPeerReady: false,
          status: isBrowserOffline() ? 'offline' : 'reconnecting',
          issue: prev.issue ?? {
            type: 'network',
            category: 'signaling',
            message: '信令服务暂时不可用，正在恢复连接。',
            detail: 'PeerJS disconnected from the signaling server',
            retryable: true,
          },
        }));
        schedulePeerRecovery();
      });

      peer.on('close', () => {
        if (!isCurrent() || recoveryBlocked) return;
        setState((prev) => ({
          ...prev,
          isPeerReady: false,
          status: isBrowserOffline() ? 'offline' : 'reconnecting',
        }));
        schedulePeerRecovery();
      });

      peer.on('error', (error) => {
        if (!isCurrent()) return;
        console.error('PeerJS error:', error);
        const issue = toPeerIssue(error);

        if (issue.category === 'connection') {
          connectionIssueIdRef.current += 1;
          setState((prev) => ({
            ...prev,
            connectionIssue: { ...issue, id: connectionIssueIdRef.current },
          }));
          return;
        }

        if (issue.category === 'identity-conflict' && allowIdentityReplacement && !preferredPeerId) {
          replaceIdentityOnRecovery = true;
          setState((prev) => ({
            ...prev,
            isPeerReady: false,
            status: 'reconnecting',
            issue: {
              ...issue,
              message: '原连接身份已失效，正在申请新的连接身份。',
            },
          }));
          schedulePeerRecovery();
          return;
        }

        if (issue.category === 'identity-conflict') {
          recoveryBlocked = true;
          clearPeerRecoveryTimer();
          setState((prev) => ({
            ...prev,
            isPeerReady: false,
            status: 'blocked',
            issue,
          }));
          return;
        }

        if (issue.category === 'fatal') {
          recoveryBlocked = true;
          clearPeerRecoveryTimer();
          setState((prev) => ({
            ...prev,
            isPeerReady: false,
            status: 'fatal',
            issue,
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          isPeerReady: false,
          status: isBrowserOffline() ? 'offline' : 'reconnecting',
          issue,
        }));
        schedulePeerRecovery();
      });
    }

    const retryPeerNow = () => {
      if (cancelled) return;
      recoveryBlocked = false;
      peerRecoveryAttemptRef.current = 0;
      clearPeerRecoveryTimer();
      setState((prev) => ({
        ...prev,
        isPeerReady: false,
        status: isBrowserOffline() ? 'offline' : 'reconnecting',
      }));
      schedulePeerRecovery(true);
    };

    retryPeerRef.current = retryPeerNow;

    const handleOffline = () => {
      if (cancelled || recoveryBlocked) return;
      clearPeerRecoveryTimer();
      setState((prev) => ({
        ...prev,
        isPeerReady: false,
        status: 'offline',
        issue: {
          type: 'offline',
          category: 'signaling',
          message: '当前设备处于离线状态，网络恢复后将自动重新连接。',
          detail: 'Browser reported an offline network state',
          retryable: true,
        },
      }));
    };

    const handleOnline = () => {
      if (cancelled || recoveryBlocked) return;
      peerRecoveryAttemptRef.current = 0;
      clearPeerRecoveryTimer();
      recoverPeer();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

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

      createPeer();
    };

    void initialize();

    return () => {
      cancelled = true;
      recoveryBlocked = true;
      retryPeerRef.current = () => undefined;
      clearPeerRecoveryTimer();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (credentialRefreshTimerRef.current) {
        clearTimeout(credentialRefreshTimerRef.current);
        credentialRefreshTimerRef.current = null;
      }
      peerGenerationRef.current += 1;
      peerRef.current?.destroy();
      peerRef.current = null;
    };
  }, [allowIdentityReplacement, persistentRecovery, preferredPeerId]);

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
    if (!peerRef.current?.open || peerRef.current.disconnected) return null;

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
    if (!peerRef.current?.open || peerRef.current.disconnected) return null;

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

  const retryPeer = useCallback(() => {
    retryPeerRef.current();
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
    retryPeer,
  };
}
