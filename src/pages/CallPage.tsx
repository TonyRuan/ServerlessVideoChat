import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Video, Mic, MicOff, VideoOff, PhoneOff, Loader2, Volume2, VolumeX, MessageCircle } from 'lucide-react';
import type { MediaConnection, DataConnection } from 'peerjs';
import { Button } from '../components/Button';
import { SettingsMenu, type VideoFitMode } from '../components/SettingsMenu';
import { ChatPanel } from '../components/ChatPanel';
import { InviteLinkCard } from '../components/InviteLinkCard';
import { NetworkDiagnosticsPanel } from '../components/NetworkDiagnosticsPanel';
import { useMediaStream, type VideoQuality } from '../hooks/useMediaStream';
import { usePeer } from '../hooks/usePeer';
import { useHeartStore, type HeartData } from '../stores/heartStore';
import { useChatStore } from '../stores/chatStore';
import type { ChatFileAttachment, ChatImageAttachment } from '../lib/chatStorage';
import {
  createChatCryptoSession,
  isChatCryptoKeyMessage,
  isEncryptedChatEnvelope,
  type ChatCryptoSession,
} from '../lib/chatCrypto';
import {
  CHAT_FILE_STREAM_CHUNK_BYTES,
  createWireChatFileAccept,
  createWireChatFileDecline,
  createWireChatFileOffer,
  createWireChatFileStreamChunk,
  createSessionResumeMessage,
  createWireChatMessage,
  isWireChatFileAcceptPayload,
  isWireChatFileChunkPayload,
  isWireChatFileDeclinePayload,
  isWireChatFileOfferPayload,
  isSessionResumePayload,
  isWireChatPayload,
  type WireChatFileChunkPayload,
  type WireChatFileOfferPayload,
  type WireChatFileSaveMode,
} from '../lib/chatProtocol';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import {
  canUseMemoryFileFallback,
  getMemoryFileFallbackLimitLabel,
} from '../lib/fileTransferLimits';
import {
  buildCallSessionHash,
  buildInviteLink,
  createCallSessionId,
  parseCallSessionHash,
  type CallSessionState,
} from '../lib/callSession';
import {
  getCallConnectionIssue,
  getEffectiveConnectionStatus,
  isPeerTransportFailed,
  type CallConnectionStatus,
} from '../lib/callConnectivity';
import {
  dataReconnectDelayMs,
  isCurrentConnection,
  shouldAcceptIncomingSessionConnection,
  turnFallbackRoleForSessionRole,
} from '../lib/callConnectionPolicy';
import {
  extractConnectionTransferStats,
  extractInboundVideoTransferStats,
  extractOutboundVideoTransferStats,
  type ConnectionTransferSample,
  type OutboundVideoTransferSample,
  type TurnUsage,
  type VideoTransferSample,
} from '../lib/mediaStats';
import { preferVideoCodecsInSdp } from '../lib/videoCodecPreference';
import {
  deriveTurnFallbackAction,
  turnFallbackStatusLabel,
  type TurnFallbackStatus,
} from '../lib/turnFallback';
import { cn } from '../lib/utils';

const connectionMatchesSession = (connection: { metadata?: unknown }, sessionId: string) => {
  const metadata = connection.metadata as Record<string, unknown> | null | undefined;
  return metadata?.sessionId === sessionId;
};

const FILE_TRANSFER_BUFFER_LIMIT_BYTES = 256 * 1024;
const FILE_TRANSFER_BUFFER_POLL_MS = 20;

interface OutgoingFileTransferState {
  file: File;
  messageId: string;
}

interface IncomingFileTransferState {
  offer: WireChatFileOfferPayload;
  bytesReceived: number;
  saveMode: WireChatFileSaveMode;
  chunks?: Uint8Array[];
  writable?: FileSystemWritableFileStreamLike;
}

interface FileSystemWritableFileStreamLike {
  write: (data: BufferSource) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
}

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandleLike>;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDataChannelBuffer = async (conn: DataConnection) => {
  const channel = conn.dataChannel;
  if (!channel) return;

  while (conn.open && channel.readyState === 'open' && channel.bufferedAmount > FILE_TRANSFER_BUFFER_LIMIT_BYTES) {
    await delay(FILE_TRANSFER_BUFFER_POLL_MS);
  }

  if (!conn.open || channel.readyState !== 'open') {
    throw new Error('聊天连接已断开');
  }
};

const sendEncryptedDataPayload = async (
  conn: DataConnection,
  session: ChatCryptoSession,
  payload: unknown
) => {
  if (!conn.open) throw new Error('聊天连接尚未建立');
  const encrypted = await session.encrypt(payload);
  conn.send(encrypted);
  await waitForDataChannelBuffer(conn);
};

const createTransferId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const fileToChatAttachment = (file: File): ChatFileAttachment => ({
  mimeType: file.type || 'application/octet-stream',
  name: file.name || 'attachment',
  size: file.size,
});

const readFileSliceAsBase64 = async (file: File, offset: number) => {
  const slice = file.slice(offset, Math.min(file.size, offset + CHAT_FILE_STREAM_CHUNK_BYTES));
  const bytes = new Uint8Array(await slice.arrayBuffer());
  return {
    bytes,
    data: bytesToBase64(bytes),
  };
};

export default function CallPage() {
  const { remotePeerId } = useParams<{ remotePeerId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    stream, 
    error: streamError, 
    isAudioEnabled, 
    isVideoEnabled, 
    initializeStream, 
    toggleAudio, 
    toggleVideo, 
    cleanup,
    currentQuality,
    changeQuality
  } = useMediaStream();
  const {
    myId,
    isPeerReady,
    error: peerError,
    callPeer,
    connectToPeer,
    onIncomingCall,
    onIncomingData,
    turnMode,
    hasTurnConfig,
    enableTurnFallback,
  } = usePeer();
  const [callSession, setCallSession] = useState<CallSessionState>(() =>
    parseCallSessionHash(location.hash) ?? {
      sessionId: createCallSessionId(),
      role: remotePeerId ? 'guest' : 'host',
    }
  );

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<CallConnectionStatus>('initializing');
  const [incomingCall, setIncomingCall] = useState<MediaConnection | null>(null);
  const [copied, setCopied] = useState(false);
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>('cover');
  const [isRemoteMuted, setIsRemoteMuted] = useState(true);
  const [rtcIceState, setRtcIceState] = useState<string>('');
  const [rtcConnectionState, setRtcConnectionState] = useState<string>('');
  const [remoteVideoWidth, setRemoteVideoWidth] = useState(0);
  const [remoteVideoHeight, setRemoteVideoHeight] = useState(0);
  const [remoteVideoReadyState, setRemoteVideoReadyState] = useState(0);
  const [remoteVideoPaused, setRemoteVideoPaused] = useState(true);
  const [inboundVideoBytes, setInboundVideoBytes] = useState<number | null>(null);
  const [inboundVideoBitrateKbps, setInboundVideoBitrateKbps] = useState<number | null>(null);
  const [inboundVideoCodec, setInboundVideoCodec] = useState<string | null>(null);
  const [outboundVideoBytes, setOutboundVideoBytes] = useState<number | null>(null);
  const [outboundVideoBitrateKbps, setOutboundVideoBitrateKbps] = useState<number | null>(null);
  const [outboundVideoCodec, setOutboundVideoCodec] = useState<string | null>(null);
  const [inboundAudioBytes, setInboundAudioBytes] = useState<number | null>(null);
  const [connectionUplinkKbps, setConnectionUplinkKbps] = useState<number | null>(null);
  const [connectionDownlinkKbps, setConnectionDownlinkKbps] = useState<number | null>(null);
  const [turnUsage, setTurnUsage] = useState<TurnUsage>({
    isUsingTurn: null,
    localCandidateType: null,
    remoteCandidateType: null,
  });
  const [remotePlayError, setRemotePlayError] = useState<string>('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isDataConnected, setIsDataConnected] = useState(false);
  const [isChatSecure, setIsChatSecure] = useState(false);
  const [conversationPeerId, setConversationPeerId] = useState<string | null>(remotePeerId ?? null);
  const [turnFallbackAttempted, setTurnFallbackAttempted] = useState(false);
  const [turnFallbackStatus, setTurnFallbackStatus] = useState<TurnFallbackStatus>('idle');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [dataReconnectAttempt, setDataReconnectAttempt] = useState(0);
  const [, setDataReconnectCount] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const connectionGenerationRef = useRef(0);
  const currentQualityRef = useRef(currentQuality);
  const inboundVideoSampleRef = useRef<VideoTransferSample | null>(null);
  const outboundVideoSampleRef = useRef<OutboundVideoTransferSample | null>(null);
  const connectionSampleRef = useRef<ConnectionTransferSample | null>(null);
  const pcCleanupRef = useRef<(() => void) | null>(null);
  const chatCryptoSessionRef = useRef<ChatCryptoSession | null>(null);
  const chatCryptoSessionPromiseRef = useRef<Promise<ChatCryptoSession> | null>(null);
  const chatCryptoPublicKeySentRef = useRef(false);
  const callSessionRef = useRef(callSession);
  const dataReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataMessageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const outgoingFileTransfersRef = useRef<Map<string, OutgoingFileTransferState>>(new Map());
  const incomingFileOffersRef = useRef<Map<string, WireChatFileOfferPayload>>(new Map());
  const incomingFileTransfersRef = useRef<Map<string, IncomingFileTransferState>>(new Map());
  
  // Heart store
  const outgoingHeart = useHeartStore(state => state.outgoingHeart);
  const receiveHeart = useHeartStore(state => state.receiveHeart);
  const unreadChatCount = useChatStore(state => state.unreadCount);
  const setChatPanelOpen = useChatStore(state => state.setPanelOpen);
  const setConversationPeers = useChatStore(state => state.setConversationPeers);
  const createLocalMessage = useChatStore(state => state.createLocalMessage);
  const addIncomingWireMessage = useChatStore(state => state.addIncomingWireMessage);
  const updateMessageStatus = useChatStore(state => state.updateMessageStatus);
  const addIncomingFileOffer = useChatStore(state => state.addIncomingFileOffer);
  const updateFileTransfer = useChatStore(state => state.updateFileTransfer);

  useEffect(() => {
    callSessionRef.current = callSession;
  }, [callSession]);

  useEffect(() => {
    return () => {
      if (dataReconnectTimerRef.current) {
        clearTimeout(dataReconnectTimerRef.current);
      }
    };
  }, []);

  // Controls visibility state
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetInactivityTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const handleActivity = () => resetInactivityTimer();

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('keydown', handleActivity);

    // Initial start
    resetInactivityTimer();

    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, [resetInactivityTimer]);

  useEffect(() => {
    setChatPanelOpen(isChatOpen);
  }, [isChatOpen, setChatPanelOpen]);

  useEffect(() => {
    if (!myId || !conversationPeerId) return;
    setConversationPeers(myId, conversationPeerId, callSession.sessionId);
  }, [callSession.sessionId, myId, conversationPeerId, setConversationPeers]);

  useEffect(() => {
    const parsed = parseCallSessionHash(location.hash);
    if (parsed && parsed.sessionId !== callSession.sessionId) {
      setCallSession(parsed);
      return;
    }

    const nextSession: CallSessionState = {
      ...callSession,
      peerId: conversationPeerId ?? remotePeerId ?? callSession.peerId,
    };
    const nextHash = buildCallSessionHash(nextSession);

    if (nextHash !== location.hash) {
      setCallSession(nextSession);
      navigate(`${location.pathname}${location.search}${nextHash}`, { replace: true });
    }
  }, [
    callSession,
    conversationPeerId,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    remotePeerId,
  ]);

  useEffect(() => {
    if (!callSession.peerId || !myId || callSession.peerId === myId) return;
    if (remotePeerId === callSession.peerId) return;

    navigate(`/call/${callSession.peerId}${buildCallSessionHash(callSession)}`, { replace: true });
  }, [callSession, myId, navigate, remotePeerId]);

  useEffect(() => {
    if (remotePeerId) {
      setConversationPeerId(remotePeerId);
    }
  }, [remotePeerId]);

  // Update ref when quality changes
  useEffect(() => {
    currentQualityRef.current = currentQuality;
  }, [currentQuality]);

  const resetChatCryptoState = useCallback(() => {
    chatCryptoSessionRef.current = null;
    chatCryptoSessionPromiseRef.current = null;
    chatCryptoPublicKeySentRef.current = false;
    setIsChatSecure(false);
  }, []);

  const ensureChatCryptoSession = useCallback(async (conn?: DataConnection | null) => {
    if (!chatCryptoSessionPromiseRef.current) {
      chatCryptoSessionPromiseRef.current = createChatCryptoSession().then((session) => {
        chatCryptoSessionRef.current = session;
        return session;
      });
    }

    const session = await chatCryptoSessionPromiseRef.current;
    if (conn?.open && !chatCryptoPublicKeySentRef.current) {
      conn.send({
        type: 'CHAT_CRYPTO_KEY',
        version: 1,
        publicKey: session.publicKey,
      });
      chatCryptoPublicKeySentRef.current = true;
    }
    return session;
  }, []);

  const createConnectionMetadata = useCallback(() => ({
    sessionId: callSessionRef.current.sessionId,
    role: callSessionRef.current.role,
    turnMode,
    ...(myId ? { peerId: myId } : {}),
  }), [myId, turnMode]);

  // Handle quality change wrapper
  const handleQualityChange = async (quality: VideoQuality) => {
    // 1. Change local quality
    await changeQuality(quality);
    
    // 2. Send quality update to peer
    if (dataConnRef.current && dataConnRef.current.open) {
      dataConnRef.current.send({ type: 'QUALITY_CHANGE', quality });
    }
  };

  // Handle outgoing heart
  useEffect(() => {
    if (outgoingHeart && dataConnRef.current && dataConnRef.current.open) {
      dataConnRef.current.send({ type: 'HEART', heart: outgoingHeart });
    }
  }, [outgoingHeart]);

  // Helper to check if data is a quality change message
  const isQualityChangeMessage = (data: unknown): data is { type: 'QUALITY_CHANGE'; quality: VideoQuality } => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'type' in data &&
      (data as Record<string, unknown>).type === 'QUALITY_CHANGE' &&
      'quality' in data
    );
  };

  // Helper to check if data is a heart message
  const isHeartMessage = (data: unknown): data is { type: 'HEART'; heart: HeartData } => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'type' in data &&
      (data as Record<string, unknown>).type === 'HEART' &&
      'heart' in data
    );
  };

  const handleIncomingFileChunk = useCallback(async (payload: WireChatFileChunkPayload) => {
    const transfer = incomingFileTransfersRef.current.get(payload.transferId);
    if (!transfer || payload.from !== transfer.offer.from) return;

    try {
      const bytes = base64ToBytes(payload.chunk.data);
      const expectedOffset = transfer.bytesReceived;
      const nextOffset = expectedOffset + bytes.length;
      const fileSize = transfer.offer.message.file.size;

      if (payload.chunk.offset !== expectedOffset || nextOffset > fileSize) {
        await transfer.writable?.abort?.();
        incomingFileTransfersRef.current.delete(payload.transferId);
        incomingFileOffersRef.current.delete(payload.transferId);
        updateFileTransfer(payload.transferId, {
          status: 'failed',
          error: '文件传输数据不连续',
        });
        return;
      }

      if (transfer.writable) {
        await transfer.writable.write(bytes);
      } else {
        transfer.chunks?.push(bytes);
      }

      transfer.bytesReceived = nextOffset;
      updateFileTransfer(payload.transferId, {
        status: 'transferring',
        bytesTransferred: nextOffset,
      });

      if (nextOffset !== fileSize) return;

      if (transfer.writable) {
        await transfer.writable.close();
        updateFileTransfer(payload.transferId, {
          status: 'saved',
          bytesTransferred: nextOffset,
        });
      } else {
        const blob = new Blob(transfer.chunks ?? [], { type: transfer.offer.message.file.mimeType });
        const objectUrl = URL.createObjectURL(blob);
        updateFileTransfer(payload.transferId, {
          status: 'ready',
          bytesTransferred: nextOffset,
          file: { objectUrl },
        });
      }

      incomingFileTransfersRef.current.delete(payload.transferId);
      incomingFileOffersRef.current.delete(payload.transferId);
    } catch (err) {
      await transfer.writable?.abort?.().catch(() => undefined);
      incomingFileTransfersRef.current.delete(payload.transferId);
      incomingFileOffersRef.current.delete(payload.transferId);
      updateFileTransfer(payload.transferId, {
        status: 'failed',
        error: err instanceof Error ? err.message : '文件接收失败',
      });
    }
  }, [updateFileTransfer]);

  const startOutgoingFileTransfer = useCallback(async (transferId: string) => {
    const transfer = outgoingFileTransfersRef.current.get(transferId);
    const conn = dataConnRef.current;
    if (!transfer) return;
    if (!conn?.open || !myId) {
      updateFileTransfer(transferId, {
        status: 'failed',
        error: '聊天连接尚未建立',
      });
      outgoingFileTransfersRef.current.delete(transferId);
      return;
    }

    const session = await ensureChatCryptoSession(conn);
    if (!session.isReady()) {
      updateFileTransfer(transferId, {
        status: 'failed',
        error: '加密通道尚未就绪',
      });
      outgoingFileTransfersRef.current.delete(transferId);
      return;
    }

    updateFileTransfer(transferId, {
      status: 'transferring',
      bytesTransferred: 0,
    });

    try {
      let offset = 0;
      let index = 0;
      while (offset < transfer.file.size) {
        const { bytes, data } = await readFileSliceAsBase64(transfer.file, offset);
        await sendEncryptedDataPayload(
          conn,
          session,
          createWireChatFileStreamChunk({
            transferId,
            from: myId,
            index,
            offset,
            data,
          })
        );

        offset += bytes.length;
        index += 1;
        updateFileTransfer(transferId, {
          status: 'transferring',
          bytesTransferred: offset,
        });
      }

      updateFileTransfer(transferId, {
        status: 'sent',
        bytesTransferred: transfer.file.size,
      });
      outgoingFileTransfersRef.current.delete(transferId);
    } catch (err) {
      updateFileTransfer(transferId, {
        status: 'failed',
        error: err instanceof Error ? err.message : '文件发送失败',
      });
      outgoingFileTransfersRef.current.delete(transferId);
    }
  }, [ensureChatCryptoSession, myId, updateFileTransfer]);

  const handleDataMessage = useCallback(async (data: unknown) => {
    if (isSessionResumePayload(data)) {
      if (data.sessionId === callSessionRef.current.sessionId) {
        setConversationPeerId(data.peerId);
        if (myId) {
          setConversationPeers(myId, data.peerId, callSessionRef.current.sessionId);
        }
      }
      return;
    }

    if (isChatCryptoKeyMessage(data)) {
      try {
        const session = await ensureChatCryptoSession(dataConnRef.current);
        await session.acceptPeerPublicKey(data.publicKey);
        setIsChatSecure(true);
      } catch (err) {
        console.error('Chat crypto handshake failed:', err);
        setIsChatSecure(false);
      }
      return;
    }

    if (isEncryptedChatEnvelope(data)) {
      try {
        const session = await ensureChatCryptoSession(dataConnRef.current);
        const payload = await session.decrypt(data);
        if (isWireChatPayload(payload)) {
          if (myId) {
            setConversationPeers(myId, payload.message.from, callSessionRef.current.sessionId);
          }
          addIncomingWireMessage(payload);
          return;
        }

        if (isWireChatFileOfferPayload(payload)) {
          if (myId) {
            setConversationPeers(myId, payload.from, callSessionRef.current.sessionId);
          }
          incomingFileOffersRef.current.set(payload.transferId, payload);
          addIncomingFileOffer(payload);
          return;
        }

        if (isWireChatFileAcceptPayload(payload)) {
          void startOutgoingFileTransfer(payload.transferId);
          return;
        }

        if (isWireChatFileDeclinePayload(payload)) {
          outgoingFileTransfersRef.current.delete(payload.transferId);
          updateFileTransfer(payload.transferId, {
            status: 'rejected',
            bytesTransferred: 0,
          });
          return;
        }

        if (isWireChatFileChunkPayload(payload)) {
          await handleIncomingFileChunk(payload);
        }
      } catch (err) {
        console.error('Encrypted chat message failed:', err);
      }
      return;
    }

    if (isQualityChangeMessage(data)) {
      const quality = data.quality;
      console.log('Received quality change request:', quality);
      if (quality.label !== currentQualityRef.current.label) {
        changeQuality(quality);
      }
    } else if (isHeartMessage(data)) {
      receiveHeart(data.heart);
    }
  }, [
    addIncomingFileOffer,
    addIncomingWireMessage,
    changeQuality,
    ensureChatCryptoSession,
    handleIncomingFileChunk,
    myId,
    receiveHeart,
    setConversationPeers,
    startOutgoingFileTransfer,
    updateFileTransfer,
  ]);

  const queueDataMessage = useCallback((data: unknown, generation: number, conn: DataConnection) => {
    const next = dataMessageQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (connectionGenerationRef.current !== generation || !isCurrentConnection(dataConnRef.current, conn)) return;
        await handleDataMessage(data);
      })
      .catch((err) => {
        console.error('Data message failed:', err);
      });
    dataMessageQueueRef.current = next;
  }, [handleDataMessage]);

  const resetDataConnection = useCallback(() => {
    resetChatCryptoState();
    dataMessageQueueRef.current = Promise.resolve();
    for (const transferId of outgoingFileTransfersRef.current.keys()) {
      updateFileTransfer(transferId, {
        status: 'failed',
        error: '聊天连接已断开',
      });
    }

    for (const [transferId, transfer] of incomingFileTransfersRef.current) {
      void transfer.writable?.abort?.();
      updateFileTransfer(transferId, {
        status: 'failed',
        error: '聊天连接已断开',
      });
    }

    for (const transferId of incomingFileOffersRef.current.keys()) {
      updateFileTransfer(transferId, {
        status: 'failed',
        error: '聊天连接已断开',
      });
    }

    outgoingFileTransfersRef.current.clear();
    incomingFileOffersRef.current.clear();
    incomingFileTransfersRef.current.clear();
    setIsDataConnected(false);
    setIsChatSecure(false);
  }, [resetChatCryptoState, updateFileTransfer]);

  const closeCurrentDataConnection = useCallback(() => {
    const conn = dataConnRef.current;
    dataConnRef.current = null;
    conn?.close();
  }, []);

  const scheduleDataReconnect = useCallback(() => {
    if (!remotePeerId) return;

    setDataReconnectCount((count) => {
      const delayMs = dataReconnectDelayMs(count);
      if (delayMs === null) return count;

      if (dataReconnectTimerRef.current) {
        clearTimeout(dataReconnectTimerRef.current);
      }
      dataReconnectTimerRef.current = setTimeout(() => {
        dataReconnectTimerRef.current = null;
        setDataReconnectAttempt((attempt) => attempt + 1);
      }, delayMs);

      return count + 1;
    });
  }, [remotePeerId]);

  const resetConnectionStats = useCallback(() => {
    inboundVideoSampleRef.current = null;
    outboundVideoSampleRef.current = null;
    connectionSampleRef.current = null;
    setInboundVideoBytes(null);
    setInboundVideoBitrateKbps(null);
    setInboundVideoCodec(null);
    setOutboundVideoBytes(null);
    setOutboundVideoBitrateKbps(null);
    setOutboundVideoCodec(null);
    setInboundAudioBytes(null);
    setConnectionUplinkKbps(null);
    setConnectionDownlinkKbps(null);
    setTurnUsage({
      isUsingTurn: null,
      localCandidateType: null,
      remoteCandidateType: null,
    });
  }, []);

  const closeActiveConnections = useCallback(() => {
    connectionGenerationRef.current += 1;
    pcCleanupRef.current?.();
    pcCleanupRef.current = null;
    callRef.current?.close();
    closeCurrentDataConnection();
    callRef.current = null;
    setIncomingCall(null);
    setRemoteStream(null);
    setRtcIceState('');
    setRtcConnectionState('');
    resetConnectionStats();
    resetDataConnection();
  }, [closeCurrentDataConnection, resetConnectionStats, resetDataConnection]);

  const setupDataConnection = useCallback((conn: DataConnection, generation = connectionGenerationRef.current) => {
    resetChatCryptoState();
    dataConnRef.current = conn;
    setConversationPeerId(conn.peer);
    if (myId) {
      setConversationPeers(myId, conn.peer, callSessionRef.current.sessionId);
    }

    const handleOpen = () => {
      if (connectionGenerationRef.current !== generation || !isCurrentConnection(dataConnRef.current, conn)) return;
      setIsDataConnected(true);
      setDataReconnectCount(0);
      if (dataReconnectTimerRef.current) {
        clearTimeout(dataReconnectTimerRef.current);
        dataReconnectTimerRef.current = null;
      }
      if (myId) {
        conn.send(createSessionResumeMessage({
          sessionId: callSessionRef.current.sessionId,
          peerId: myId,
          role: callSessionRef.current.role,
        }));
      }
      void ensureChatCryptoSession(conn).catch((err) => {
        console.error('Unable to start chat crypto session:', err);
        setIsChatSecure(false);
      });
    };

    const handleClose = () => {
      if (connectionGenerationRef.current !== generation) return;
      if (isCurrentConnection(dataConnRef.current, conn)) {
        dataConnRef.current = null;
        resetDataConnection();
        scheduleDataReconnect();
      }
    };

    conn.on('open', handleOpen);
    conn.on('data', (data: unknown) => {
      if (connectionGenerationRef.current !== generation || !isCurrentConnection(dataConnRef.current, conn)) return;
      queueDataMessage(data, generation, conn);
    });
    conn.on('close', handleClose);
    conn.on('error', (err) => {
      console.error('Data connection error:', err);
      handleClose();
    });

    if (conn.open) {
      handleOpen();
    }
  }, [
    ensureChatCryptoSession,
    myId,
    queueDataMessage,
    resetChatCryptoState,
    resetDataConnection,
    scheduleDataReconnect,
    setConversationPeers,
  ]);

  // Initialize local stream
  useEffect(() => {
    initializeStream();
    return () => cleanup();
  }, [initializeStream, cleanup]);

  const attachPeerConnectionDebug = useCallback((pc: RTCPeerConnection | null | undefined) => {
    pcCleanupRef.current?.();
    pcCleanupRef.current = null;

    if (!pc) return;

    const update = () => {
      setRtcIceState(pc.iceConnectionState);
      setRtcConnectionState(pc.connectionState);
    };

    update();
    pc.addEventListener('iceconnectionstatechange', update);
    pc.addEventListener('connectionstatechange', update);

    pcCleanupRef.current = () => {
      pc.removeEventListener('iceconnectionstatechange', update);
      pc.removeEventListener('connectionstatechange', update);
    };
  }, []);

  useEffect(() => {
    return () => {
      pcCleanupRef.current?.();
      pcCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const action = deriveTurnFallbackAction({
      role: turnFallbackRoleForSessionRole(callSession.role),
      turnMode,
      hasTurnConfig,
      attempted: turnFallbackAttempted,
      iceState: rtcIceState,
      peerConnectionState: rtcConnectionState,
    });
    if (action === 'none') return;

    if (!enableTurnFallback()) return;

    setTurnFallbackAttempted(true);
    closeActiveConnections();

    if (action === 'retry') {
      setTurnFallbackStatus('retrying');
      setConnectionStatus('connecting');
      setReconnectAttempt((attempt) => attempt + 1);
    } else {
      setTurnFallbackStatus('waiting');
      setConnectionStatus('waiting');
    }
  }, [
    closeActiveConnections,
    callSession.role,
    enableTurnFallback,
    hasTurnConfig,
    remotePeerId,
    rtcConnectionState,
    rtcIceState,
    turnFallbackAttempted,
    turnMode,
  ]);

  useEffect(() => {
    if (turnFallbackStatus === 'idle') return;
    if (connectionStatus !== 'connected') return;
    if (isPeerTransportFailed(rtcIceState, rtcConnectionState)) return;
    setTurnFallbackStatus('active');
  }, [connectionStatus, rtcConnectionState, rtcIceState, turnFallbackStatus]);

  // Handle local video stream
  useEffect(() => {
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = stream;
    }
    
    // If stream changes (e.g. quality change), we need to replace the track in the peer connection
    if (callRef.current && stream) {
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      
      if (callRef.current.peerConnection) {
        const senders = callRef.current.peerConnection.getSenders();
        
        if (videoTrack) {
          const videoSender = senders.find(s => s.track?.kind === 'video');
          if (videoSender) videoSender.replaceTrack(videoTrack);
        }
        
        if (audioTrack) {
          const audioSender = senders.find(s => s.track?.kind === 'audio');
          if (audioSender) audioSender.replaceTrack(audioTrack);
        }
      }
    }
  }, [stream]);

  // Handle remote video stream
  useEffect(() => {
    if (!remoteVideoRef.current || !remoteStream) return;

    const video = remoteVideoRef.current;
    video.srcObject = remoteStream;
    video.muted = isRemoteMuted;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    const update = () => {
      setRemoteVideoWidth(video.videoWidth || 0);
      setRemoteVideoHeight(video.videoHeight || 0);
      setRemoteVideoReadyState(video.readyState || 0);
      setRemoteVideoPaused(video.paused);
    };

    update();
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    video.addEventListener('playing', update);
    video.addEventListener('pause', update);

    setRemotePlayError('');
    void video.play().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setRemotePlayError(message);
      if (!video.muted) {
        video.muted = true;
        setIsRemoteMuted(true);
      }
      void video.play().catch((err2) => {
        const message2 = err2 instanceof Error ? err2.message : String(err2);
        setRemotePlayError(message2);
      });
    });

    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
      video.removeEventListener('playing', update);
      video.removeEventListener('pause', update);
    };
  }, [remoteStream, isRemoteMuted]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const pc = callRef.current?.peerConnection;
      if (!pc) return;

      try {
        const stats = await pc.getStats();
        const videoTransfer = extractInboundVideoTransferStats(stats, inboundVideoSampleRef.current);
        const outboundVideoTransfer = extractOutboundVideoTransferStats(stats, outboundVideoSampleRef.current);
        const connectionTransfer = extractConnectionTransferStats(stats, connectionSampleRef.current);
        inboundVideoSampleRef.current = videoTransfer.sample;
        outboundVideoSampleRef.current = outboundVideoTransfer.sample;
        connectionSampleRef.current = connectionTransfer.sample;
        let audioBytes = 0;
        let hasAudio = false;

        stats.forEach((report) => {
          const r = report as unknown as {
            type?: string;
            kind?: string;
            mediaType?: string;
            bytesReceived?: number;
          };
          if (r.type !== 'inbound-rtp') return;
          const kind = r.kind ?? r.mediaType;
          if (kind === 'audio') {
            hasAudio = true;
            audioBytes += r.bytesReceived ?? 0;
          }
        });

        setInboundVideoBytes(videoTransfer.metrics.bytesReceived);
        setInboundVideoBitrateKbps(videoTransfer.metrics.bitrateKbps);
        setInboundVideoCodec(videoTransfer.metrics.codec);
        setOutboundVideoBytes(outboundVideoTransfer.metrics.bytesSent);
        setOutboundVideoBitrateKbps(outboundVideoTransfer.metrics.bitrateKbps);
        setOutboundVideoCodec(outboundVideoTransfer.metrics.codec);
        setInboundAudioBytes(hasAudio ? audioBytes : null);
        setConnectionUplinkKbps(connectionTransfer.metrics.uplinkKbps);
        setConnectionDownlinkKbps(connectionTransfer.metrics.downlinkKbps);
        setTurnUsage(connectionTransfer.metrics.turnUsage);
      } catch {
        // Stats may be temporarily unavailable while the peer connection is changing state.
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Handle connection logic
  // 1. Caller logic (Initiate call)
  useEffect(() => {
    if (!isPeerReady || !stream || !remotePeerId) return;
    
    // We are the caller
    // Only initiate call if not already called
    if (!callRef.current) {
      setConnectionStatus('connecting');
      const generation = connectionGenerationRef.current;
      const call = callPeer(remotePeerId, stream, createConnectionMetadata());

      if (call) {
        callRef.current = call;
        attachPeerConnectionDebug(call.peerConnection);
        call.on('stream', (remoteStream) => {
          if (connectionGenerationRef.current !== generation || !isCurrentConnection(callRef.current, call)) return;
          setRemoteStream(remoteStream);
          setConnectionStatus('connected');
        });

        call.on('close', () => {
          if (connectionGenerationRef.current !== generation || !isCurrentConnection(callRef.current, call)) return;
          setConnectionStatus('disconnected');
          setRemoteStream(null);
          closeCurrentDataConnection();
          callRef.current = null;
          resetDataConnection();
          setRtcIceState('');
          setRtcConnectionState('');
          resetConnectionStats();
          attachPeerConnectionDebug(null);
        });

        call.on('error', (err) => {
            if (connectionGenerationRef.current !== generation || !isCurrentConnection(callRef.current, call)) return;
            console.error('Call error:', err);
            setConnectionStatus('disconnected');
            setRemoteStream(null);
            closeCurrentDataConnection();
            callRef.current = null;
            resetDataConnection();
            setRtcIceState('');
            setRtcConnectionState('');
            resetConnectionStats();
            attachPeerConnectionDebug(null);
        });
      }
    }

    // Also establish data connection if not exists
    if (!dataConnRef.current) {
      const conn = connectToPeer(remotePeerId, createConnectionMetadata());
      if (conn) {
        setupDataConnection(conn, connectionGenerationRef.current);
      }
    }
  }, [
    isPeerReady,
    stream,
    remotePeerId,
    callPeer,
    connectToPeer,
    createConnectionMetadata,
    attachPeerConnectionDebug,
    closeCurrentDataConnection,
    resetConnectionStats,
    resetDataConnection,
    setupDataConnection,
    reconnectAttempt,
    dataReconnectAttempt,
  ]);

  // 2. Register incoming listeners so same-session refreshes can replace old connections.
  // Register listeners immediately when Peer is ready, do NOT wait for stream.
  useEffect(() => {
    if (!isPeerReady) return;

    if (!remotePeerId) {
      setConnectionStatus('waiting');
    }

    onIncomingCall((call) => {
      console.log('Incoming call received');
      const isSameSession = connectionMatchesSession(call, callSessionRef.current.sessionId);
      if (!shouldAcceptIncomingSessionConnection({ isSameSession })) {
        call.close();
        return;
      }
      const metadata = call.metadata as { turnMode?: string } | undefined;
      if (metadata?.turnMode && metadata.turnMode !== 'off') {
        enableTurnFallback();
      }
      if (callRef.current) {
        closeActiveConnections();
      }
      setConversationPeerId(call.peer);
      setIncomingCall(call);
      setConnectionStatus('connecting');
    });

    onIncomingData((conn) => {
      console.log('Incoming data connection received');
      const isSameSession = connectionMatchesSession(conn, callSessionRef.current.sessionId);
      if (!shouldAcceptIncomingSessionConnection({ isSameSession })) {
        conn.close();
        return;
      }
      const metadata = conn.metadata as { turnMode?: string } | undefined;
      if (metadata?.turnMode && metadata.turnMode !== 'off') {
        enableTurnFallback();
      }
      if (dataConnRef.current && dataConnRef.current !== conn) {
        const previousConn = dataConnRef.current;
        dataConnRef.current = null;
        resetDataConnection();
        previousConn.close();
      }
      setupDataConnection(conn, connectionGenerationRef.current);
    });
  }, [
    closeActiveConnections,
    enableTurnFallback,
    isPeerReady,
    onIncomingCall,
    onIncomingData,
    remotePeerId,
    resetDataConnection,
    setupDataConnection,
  ]);

  // 3. Callee logic - Handle incoming call events
  useEffect(() => {
    if (!incomingCall) return;
    const generation = connectionGenerationRef.current;

    // Register listeners immediately
    attachPeerConnectionDebug(incomingCall.peerConnection);
    incomingCall.on('stream', (remoteStream) => {
      if (connectionGenerationRef.current !== generation || !isCurrentConnection(callRef.current, incomingCall)) return;
      console.log('Received remote stream');
      setRemoteStream(remoteStream);
      setConnectionStatus('connected');
    });

    incomingCall.on('close', () => {
      if (connectionGenerationRef.current !== generation || !isCurrentConnection(callRef.current, incomingCall)) return;
      setConnectionStatus('disconnected');
      setRemoteStream(null);
      closeCurrentDataConnection();
      callRef.current = null;
      setIncomingCall(null);
      resetDataConnection();
      setRtcIceState('');
      setRtcConnectionState('');
      resetConnectionStats();
      attachPeerConnectionDebug(null);
    });

    incomingCall.on('error', (err) => {
      if (connectionGenerationRef.current !== generation || !isCurrentConnection(callRef.current, incomingCall)) return;
      console.error('Incoming call error:', err);
      setConnectionStatus('disconnected');
      setRemoteStream(null);
      closeCurrentDataConnection();
      callRef.current = null;
      setIncomingCall(null);
      resetDataConnection();
      setRtcIceState('');
      setRtcConnectionState('');
      resetConnectionStats();
      attachPeerConnectionDebug(null);
    });

    return () => {
      // Cleanup listeners if needed? PeerJS handles this on close
    };
  }, [incomingCall, attachPeerConnectionDebug, closeCurrentDataConnection, resetConnectionStats, resetDataConnection]);

  // 4. Callee logic - Answer call (Stream handling)
  // Answer call when stream becomes available
  useEffect(() => {
    if (!incomingCall || !stream) return;
    if (callRef.current === incomingCall) return; // Already answered

    console.log('Answering incoming call with stream');
    incomingCall.answer(stream, {
      sdpTransform: preferVideoCodecsInSdp,
    });
    callRef.current = incomingCall;
    attachPeerConnectionDebug(incomingCall.peerConnection);
  }, [incomingCall, stream, attachPeerConnectionDebug]);

  const handleSendChat = useCallback(async ({
    text,
    image,
    file,
  }: {
    text?: string;
    image?: ChatImageAttachment;
    file?: File;
  }) => {
    if (!myId) {
      throw new Error('Peer 尚未就绪');
    }

    const transferId = file ? createTransferId() : undefined;
    const message = createLocalMessage({
      myPeerId: myId,
      id: transferId,
      text,
      image,
      file: file ? fileToChatAttachment(file) : undefined,
      fileTransfer: file && transferId
        ? {
            id: transferId,
            status: 'waiting',
            bytesTransferred: 0,
          }
        : undefined,
    });
    if (!message) {
      throw new Error('没有可发送的内容');
    }

    const conn = dataConnRef.current;
    if (!conn?.open) {
      updateMessageStatus(message.id, 'failed');
      throw new Error('聊天连接尚未建立');
    }

    const session = await ensureChatCryptoSession(conn);
    if (!session.isReady()) {
      updateMessageStatus(message.id, 'failed');
      throw new Error('加密通道尚未就绪');
    }

    try {
      if (file && message.file) {
        outgoingFileTransfersRef.current.set(message.id, {
          file,
          messageId: message.id,
        });
        await sendEncryptedDataPayload(conn, session, createWireChatFileOffer(message, myId));
      } else {
        await sendEncryptedDataPayload(conn, session, createWireChatMessage(message, myId));
      }
      updateMessageStatus(message.id, 'sent');
    } catch (err) {
      outgoingFileTransfersRef.current.delete(message.id);
      updateMessageStatus(message.id, 'failed');
      throw err instanceof Error ? err : new Error('发送失败');
    }
  }, [createLocalMessage, ensureChatCryptoSession, myId, updateMessageStatus]);

  const handleAcceptFileTransfer = useCallback(async (messageId: string) => {
    const offer = incomingFileOffersRef.current.get(messageId);
    const message = useChatStore.getState().messages.find((item) => item.id === messageId);
    if (!offer || !message?.file) {
      updateFileTransfer(messageId, {
        status: 'failed',
        error: '文件接收请求已失效',
      });
      throw new Error('文件接收请求已失效');
    }

    if (!myId) {
      throw new Error('Peer 尚未就绪');
    }

    const conn = dataConnRef.current;
    if (!conn?.open) {
      updateFileTransfer(messageId, {
        status: 'failed',
        error: '聊天连接尚未建立',
      });
      throw new Error('聊天连接尚未建立');
    }

    if (incomingFileTransfersRef.current.has(messageId)) return;

    let writable: FileSystemWritableFileStreamLike | undefined;
    let saveMode: WireChatFileSaveMode = 'memory';

    try {
      const picker = (window as WindowWithSaveFilePicker).showSaveFilePicker;
      if (picker) {
        const handle = await picker({ suggestedName: message.file.name });
        writable = await handle.createWritable();
        saveMode = 'file-system';
      } else if (!canUseMemoryFileFallback(message.file.size)) {
        throw new Error(`当前浏览器不支持直接保存到磁盘，超过 ${getMemoryFileFallbackLimitLabel()} 的文件无法接收`);
      }

      const session = await ensureChatCryptoSession(conn);
      if (!session.isReady()) {
        throw new Error('加密通道尚未就绪');
      }

      incomingFileTransfersRef.current.set(messageId, {
        offer,
        bytesReceived: 0,
        saveMode,
        writable,
        chunks: writable ? undefined : [],
      });
      updateFileTransfer(messageId, {
        status: 'transferring',
        bytesTransferred: 0,
        saveMode,
        error: undefined,
      });
      await sendEncryptedDataPayload(conn, session, createWireChatFileAccept(messageId, myId, saveMode));
    } catch (err) {
      const errorName = typeof err === 'object' && err !== null && 'name' in err
        ? (err as { name?: unknown }).name
        : undefined;
      if (errorName === 'AbortError') return;

      await writable?.abort?.();
      incomingFileTransfersRef.current.delete(messageId);
      updateFileTransfer(messageId, {
        status: 'failed',
        error: err instanceof Error ? err.message : '无法接收文件',
      });
      throw err instanceof Error ? err : new Error('无法接收文件');
    }
  }, [ensureChatCryptoSession, myId, updateFileTransfer]);

  const handleDeclineFileTransfer = useCallback(async (messageId: string) => {
    if (!myId) {
      throw new Error('Peer 尚未就绪');
    }

    const conn = dataConnRef.current;
    if (!conn?.open) {
      updateFileTransfer(messageId, {
        status: 'failed',
        error: '聊天连接尚未建立',
      });
      throw new Error('聊天连接尚未建立');
    }

    const session = await ensureChatCryptoSession(conn);
    if (!session.isReady()) {
      updateFileTransfer(messageId, {
        status: 'failed',
        error: '加密通道尚未就绪',
      });
      throw new Error('加密通道尚未就绪');
    }

    await sendEncryptedDataPayload(conn, session, createWireChatFileDecline(messageId, myId));
    incomingFileOffersRef.current.delete(messageId);
    incomingFileTransfersRef.current.delete(messageId);
    updateFileTransfer(messageId, {
      status: 'rejected',
      bytesTransferred: 0,
    });
  }, [ensureChatCryptoSession, myId, updateFileTransfer]);

  const copyLink = () => {
    const baseUrl = window.location.origin + import.meta.env.BASE_URL;
    const link = buildInviteLink(baseUrl, myId, callSession.sessionId);
    
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inviteLink = (() => {
    const baseUrl = window.location.origin + import.meta.env.BASE_URL;
    return buildInviteLink(baseUrl, myId, callSession.sessionId);
  })();

  const endCall = () => {
    if (callRef.current) {
      callRef.current.close();
    }
    closeCurrentDataConnection();
    resetDataConnection();
    navigate('/');
  };

  const effectiveConnectionStatus = getEffectiveConnectionStatus(
    connectionStatus,
    rtcIceState,
    rtcConnectionState
  );
  const callConnectionIssue = getCallConnectionIssue(
    rtcIceState,
    rtcConnectionState,
    Boolean(remoteStream)
  );
  const displayedCallConnectionIssue =
    turnFallbackStatus === 'retrying' || turnFallbackStatus === 'waiting' ? null : callConnectionIssue;
  const transportFailureHint = (() => {
    if (rtcIceState !== 'failed' || turnFallbackStatus !== 'idle') return '';
    if (!hasTurnConfig) {
      return '当前网络直连失败，通常需要配置 TURN 中继服务才能跨设备稳定通话。';
    }
    if (turnMode === 'off') {
      return '当前已关闭初始 TURN 候选，直连失败；可移除 turn=0 或启用 TURN 后重试。';
    }
    return '已启用 TURN 候选但连接仍失败，请检查 TURN 地址、凭据、防火墙和 relay 端口，或使用 turn=force 排障。';
  })();

  if (streamError || peerError) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-500 text-xl">连接服务发生错误</p>
          <p className="text-gray-400">可能是网络问题或服务暂时不可用。</p>
          <p className="text-sm text-gray-500">{streamError?.message || peerError?.message}</p>
          <Button onClick={() => navigate('/')}>返回首页</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white overflow-hidden relative">
      {/* Remote Video (Full Screen) */}
      <div className="absolute inset-0 flex items-center justify-center">
        {remoteStream ? (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={isRemoteMuted}
              className={cn(
                "w-full h-full transition-all duration-300",
                videoFitMode === 'cover' ? "object-cover" : "object-contain bg-black"
              )}
            />
            {remoteStream.getVideoTracks().length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="px-4 py-2 rounded-lg bg-gray-900/70 text-sm text-gray-200 border border-gray-700">
                  对方未发送视频轨道（可能关闭了摄像头或没有授权）
                </div>
              </div>
            )}
            {displayedCallConnectionIssue && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-950/70 p-4">
                <div className="max-w-md rounded-xl border border-amber-500/40 bg-gray-900/90 px-4 py-3 text-center text-sm text-amber-100 shadow-xl">
                  <p className="font-semibold text-amber-300">连接已失败</p>
                  <p className="mt-2">{displayedCallConnectionIssue}</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="max-h-screen w-full overflow-y-auto px-4 pb-28 pt-20 text-center">
            <div className="space-y-4">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-800 animate-pulse">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            </div>
            <h2 className="text-2xl font-semibold">
              {connectionStatus === 'waiting' ? '等待对方加入...' :
               connectionStatus === 'connecting' ? '连接中...' :
               connectionStatus === 'connected' ? '已连接' :
               connectionStatus === 'disconnected' ? '连接已断开' :
               '初始化中...'}
            </h2>

            {(rtcIceState || rtcConnectionState) && (
              <p className="text-sm text-gray-500">
                ICE: {rtcIceState || '-'} / PC: {rtcConnectionState || '-'}
              </p>
            )}

            {turnFallbackStatus !== 'idle' && turnFallbackStatus !== 'active' && (
              <p className="text-sm text-amber-300">{turnFallbackStatusLabel(turnFallbackStatus)}</p>
            )}

            {transportFailureHint && (
              <p className="text-sm text-amber-400">
                {transportFailureHint}
              </p>
            )}

            {connectionStatus === 'waiting' && myId && (
              <InviteLinkCard inviteLink={inviteLink} copied={copied} onCopy={copyLink} />
            )}
            </div>
          </div>
        )}
      </div>

      {/* Local Video (PIP) */}
      <div className="absolute top-4 right-4 w-48 aspect-video bg-gray-800 rounded-lg overflow-hidden shadow-2xl ring-1 ring-gray-700 transition-all duration-300 z-10">
        {stream && (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
        )}
      </div>

      <ChatPanel
        isOpen={isChatOpen}
        isConnected={isDataConnected}
        isSecure={isChatSecure}
        connectionIssue={displayedCallConnectionIssue}
        onClose={() => setIsChatOpen(false)}
        onSend={handleSendChat}
        onAcceptFileTransfer={handleAcceptFileTransfer}
        onDeclineFileTransfer={handleDeclineFileTransfer}
      />

      {/* Controls Bar */}
      <div className={cn(
        "absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 px-8 py-4 bg-gray-800/90 backdrop-blur-sm rounded-full shadow-2xl border border-gray-700 z-50 transition-all duration-300 ease-in-out",
        showControls || isChatOpen ? "translate-y-0 opacity-100" : "translate-y-24 opacity-0 pointer-events-none"
      )}>
        <Button
          variant={isAudioEnabled ? 'secondary' : 'danger'}
          size="icon"
          className="rounded-full h-14 w-14"
          onClick={toggleAudio}
        >
          {isAudioEnabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </Button>

        <Button
          variant={isRemoteMuted ? 'secondary' : 'secondary'}
          size="icon"
          className="rounded-full h-14 w-14"
          onClick={() => setIsRemoteMuted((v) => !v)}
          title={isRemoteMuted ? '开启对方声音' : '静音对方声音'}
        >
          {isRemoteMuted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
        </Button>

        <Button
            variant={isVideoEnabled ? "secondary" : "danger"}
            size="icon"
            className="rounded-full h-12 w-12 bg-gray-700 hover:bg-gray-600"
            onClick={toggleVideo}
            title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
          >
            {isVideoEnabled ? <Video className="h-5 w-5 text-white" /> : <VideoOff className="h-5 w-5 text-white" />}
          </Button>

          <SettingsMenu
            currentQuality={currentQuality}
            onQualityChange={handleQualityChange}
            videoFitMode={videoFitMode}
            onVideoFitModeChange={setVideoFitMode}
            disabled={!stream}
          />

          <Button
            variant={isChatOpen ? 'primary' : 'secondary'}
            size="icon"
            className="relative h-12 w-12 rounded-full bg-gray-700 hover:bg-gray-600"
            onClick={() => setIsChatOpen((value) => !value)}
            title="聊天"
          >
            <MessageCircle className="h-5 w-5 text-white" />
            {unreadChatCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                {unreadChatCount > 9 ? '9+' : unreadChatCount}
              </span>
            )}
          </Button>

          <Button
            variant="danger"
            size="icon"
            className="rounded-full h-12 w-12 hover:bg-red-700"
            onClick={endCall}
            title="End call"
          >
            <PhoneOff className="h-5 w-5 text-white" />
          </Button>
      </div>
      
      <NetworkDiagnosticsPanel
        effectiveConnectionStatus={effectiveConnectionStatus}
        rtcIceState={rtcIceState}
        rtcConnectionState={rtcConnectionState}
        remoteTrackCounts={{
          video: remoteStream ? remoteStream.getVideoTracks().length : 0,
          audio: remoteStream ? remoteStream.getAudioTracks().length : 0,
        }}
        remoteVideo={{
          width: remoteVideoWidth,
          height: remoteVideoHeight,
          readyState: remoteVideoReadyState,
          paused: remoteVideoPaused,
        }}
        inbound={{
          videoBytes: inboundVideoBytes,
          videoBitrateKbps: inboundVideoBitrateKbps,
          videoCodec: inboundVideoCodec,
          audioBytes: inboundAudioBytes,
        }}
        outbound={{
          videoBytes: outboundVideoBytes,
          videoBitrateKbps: outboundVideoBitrateKbps,
          videoCodec: outboundVideoCodec,
        }}
        connection={{
          uplinkKbps: connectionUplinkKbps,
          downlinkKbps: connectionDownlinkKbps,
          turnUsage,
        }}
        turnFallbackStatus={turnFallbackStatus}
        remotePlayError={remotePlayError}
      />
    </div>
  );
}
