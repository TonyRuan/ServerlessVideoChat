import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Loader2, Volume2, VolumeX } from 'lucide-react';
import type { MediaConnection, DataConnection } from 'peerjs';
import { Button } from '../components/Button';
import type { VideoFitMode } from '../components/SettingsMenu';
import { CallControls } from '../components/CallControls';
import { ChatPanel } from '../components/ChatPanel';
import { InviteLinkCard } from '../components/InviteLinkCard';
import { NetworkDiagnosticsPanel } from '../components/NetworkDiagnosticsPanel';
import { useMediaStream, VIDEO_QUALITIES, type VideoQuality } from '../hooks/useMediaStream';
import { usePeer } from '../hooks/usePeer';
import { useAutoHideControls } from '../hooks/useAutoHideControls';
import { useHeartStore } from '../stores/heartStore';
import { useChatStore } from '../stores/chatStore';
import type { ChatFileAttachment, ChatImageAttachment } from '../lib/chatStorage';
import {
  createChatCryptoSession,
  isChatCryptoKeyMessage,
  isEncryptedBinaryChatEnvelope,
  isEncryptedChatEnvelope,
  type ChatCryptoSession,
} from '../lib/chatCrypto';
import {
  CHAT_FILE_STREAM_CHUNK_BYTES,
  createWireChatFileAccept,
  createWireChatFileComplete,
  createWireChatFileCredit,
  createWireChatFileDecline,
  createWireChatFileError,
  createWireChatFileOffer,
  createSessionResumeMessage,
  createWireChatMessage,
  isWireChatFileAcceptPayload,
  isWireChatFileCompletePayload,
  isWireChatFileCreditPayload,
  isWireChatFileDeclinePayload,
  isWireChatFileErrorPayload,
  isWireChatFileOfferPayload,
  isSessionResumePayload,
  isWireChatPayload,
  type WireChatFileOfferPayload,
  type WireChatFileSaveMode,
} from '../lib/chatProtocol';
import {
  canUseMemoryFileFallback,
  getMemoryFileFallbackLimitLabel,
} from '../lib/fileTransferLimits';
import {
  DATA_CONNECTION_BUFFER_LIMIT_BYTES,
  sendDataConnectionPayload,
} from '../lib/dataConnectionPayload';
import {
  claimOutgoingFileTransferStart,
  shouldPublishFileTransferProgress,
} from '../lib/fileTransferProgress';
import {
  decodeFileChunkFrame,
  encodeFileChunkFrame,
  type BinaryFileChunkFrame,
} from '../lib/fileTransferBinary';
import {
  FILE_TRANSFER_CREDIT_WINDOW_BYTES,
  advanceFileTransferWindow,
  applyFileTransferCredit,
  canSendFileChunk,
  createFileTransferSendWindow,
  resumeFileTransferWindow,
  type FileTransferSendWindow,
} from '../lib/fileTransferFlow';
import {
  buildCallSessionHash,
  buildInviteLink,
  createCallSessionId,
  parseCallSessionHash,
  resolveCallSessionState,
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
  getDataConnectionChannel,
  isIncomingConnectionMetadataValid,
  isCurrentConnection,
  isPayloadPeerValid,
  isSessionResumePeerValid,
  shouldInitiateOutgoingConnection,
  shouldReplaceCurrentMediaConnection,
  shouldReplaceCurrentDataConnection,
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
import { isHeartPayload, isQualityChangePayload } from '../lib/realtimeProtocol';

const FILE_TRANSFER_BUFFER_POLL_MS = 20;

interface OutgoingFileTransferState {
  file: File;
  messageId: string;
  isStarted: boolean;
  window: FileTransferSendWindow;
  lastProgressUpdateAt: number;
  lastProgressUpdateBytes: number;
}

interface IncomingFileTransferState {
  offer: WireChatFileOfferPayload;
  bytesReceived: number;
  lastProgressUpdateAt: number;
  lastProgressUpdateBytes: number;
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

  while (conn.open && channel.readyState === 'open' && channel.bufferedAmount > DATA_CONNECTION_BUFFER_LIMIT_BYTES) {
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
  const encrypted = await session.encrypt(payload);
  await sendDataConnectionPayload(conn, encrypted);
  await waitForDataChannelBuffer(conn);
};

const sendEncryptedBinaryPayload = async (
  conn: DataConnection,
  session: ChatCryptoSession,
  payload: Uint8Array
) => {
  const encrypted = await session.encryptBytes(payload);
  await sendDataConnectionPayload(conn, encrypted);
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

const isSameCallSession = (a: CallSessionState, b: CallSessionState) =>
  a.sessionId === b.sessionId && a.role === b.role && a.peerId === b.peerId;

const readFileSlice = async (file: File, offset: number) => {
  const slice = file.slice(offset, Math.min(file.size, offset + CHAT_FILE_STREAM_CHUNK_BYTES));
  return new Uint8Array(await slice.arrayBuffer());
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
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [isDataConnected, setIsDataConnected] = useState(false);
  const [isChatSecure, setIsChatSecure] = useState(false);
  const [conversationPeerId, setConversationPeerId] = useState<string | null>(remotePeerId ?? null);
  const [turnFallbackAttempted, setTurnFallbackAttempted] = useState(false);
  const [turnFallbackStatus, setTurnFallbackStatus] = useState<TurnFallbackStatus>('idle');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [, setMediaReconnectCount] = useState(0);
  const [dataReconnectAttempt, setDataReconnectAttempt] = useState(0);
  const [, setDataReconnectCount] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const mobileMorePanelRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const bulkDataConnRef = useRef<DataConnection | null>(null);
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
  const mediaReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectEnabledRef = useRef(true);
  const dataMessageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const bulkMessageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const outgoingFileTransfersRef = useRef<Map<string, OutgoingFileTransferState>>(new Map());
  const incomingFileOffersRef = useRef<Map<string, WireChatFileOfferPayload>>(new Map());
  const acceptingFileTransfersRef = useRef<Set<string>>(new Set());
  const incomingFileTransfersRef = useRef<Map<string, IncomingFileTransferState>>(new Map());
  const pendingFileCompletionsRef = useRef<Map<string, { from: string; bytesReceived: number }>>(new Map());
  
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
    reconnectEnabledRef.current = true;
    return () => {
      reconnectEnabledRef.current = false;
      if (dataReconnectTimerRef.current) {
        clearTimeout(dataReconnectTimerRef.current);
      }
      if (mediaReconnectTimerRef.current) {
        clearTimeout(mediaReconnectTimerRef.current);
      }
    };
  }, []);

  const showControls = useAutoHideControls();

  useEffect(() => {
    setChatPanelOpen(isChatOpen);
  }, [isChatOpen, setChatPanelOpen]);

  useEffect(() => {
    if (isChatOpen) {
      setIsMobileMoreOpen(false);
    }
  }, [isChatOpen]);

  useEffect(() => {
    if (!isMobileMoreOpen || typeof document === 'undefined') return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mobileMorePanelRef.current?.focus();

    return () => previousFocus?.focus();
  }, [isMobileMoreOpen]);

  useEffect(() => {
    if (!myId || !conversationPeerId) return;
    setConversationPeers(myId, conversationPeerId, callSession.sessionId);
  }, [callSession.sessionId, myId, conversationPeerId, setConversationPeers]);

  useEffect(() => {
    const nextSession = resolveCallSessionState(
      location.hash,
      callSession,
      conversationPeerId ?? remotePeerId
    );
    const nextHash = buildCallSessionHash(nextSession);

    if (!isSameCallSession(nextSession, callSession)) {
      setCallSession(nextSession);
    }
    if (nextHash !== location.hash) {
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
      sendDataConnectionPayload(conn, {
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
      sendDataConnectionPayload(dataConnRef.current, { type: 'QUALITY_CHANGE', quality });
    }
  };

  // Handle outgoing heart
  useEffect(() => {
    if (outgoingHeart && dataConnRef.current && dataConnRef.current.open) {
      sendDataConnectionPayload(dataConnRef.current, { type: 'HEART', heart: outgoingHeart });
    }
  }, [outgoingHeart]);

  const sendFileControlPayload = useCallback(async (payload: unknown) => {
    const conn = dataConnRef.current;
    if (!conn?.open) throw new Error('聊天连接尚未建立');
    const session = await ensureChatCryptoSession(conn);
    if (!session.isReady()) throw new Error('加密通道尚未就绪');
    await sendEncryptedDataPayload(conn, session, payload);
  }, [ensureChatCryptoSession]);

  const handleIncomingFileChunk = useCallback(async (payload: BinaryFileChunkFrame) => {
    const transfer = incomingFileTransfersRef.current.get(payload.transferId);
    if (!transfer || payload.from !== transfer.offer.from) return;

    try {
      const fileSize = transfer.offer.message.file.size;
      if (payload.offset < transfer.bytesReceived) return;
      if (payload.offset !== transfer.bytesReceived) {
        throw new Error(`文件传输数据不连续（期望 ${transfer.bytesReceived}，收到 ${payload.offset}）`);
      }

      const expectedLength = Math.min(CHAT_FILE_STREAM_CHUNK_BYTES, fileSize - payload.offset);
      if (expectedLength <= 0 || payload.data.byteLength !== expectedLength) {
        throw new Error(`文件分片大小异常（offset ${payload.offset}，大小 ${payload.data.byteLength}）`);
      }

      if (transfer.writable) {
        await transfer.writable.write(payload.data);
      } else {
        transfer.chunks?.push(payload.data);
      }

      transfer.bytesReceived += payload.data.byteLength;
      const now = Date.now();
      if (shouldPublishFileTransferProgress({
        bytesTransferred: transfer.bytesReceived,
        totalBytes: fileSize,
        snapshot: {
          lastUpdateAt: transfer.lastProgressUpdateAt,
          lastUpdateBytes: transfer.lastProgressUpdateBytes,
        },
        now,
      })) {
        transfer.lastProgressUpdateAt = now;
        transfer.lastProgressUpdateBytes = transfer.bytesReceived;
        updateFileTransfer(payload.transferId, {
          status: 'transferring',
          bytesTransferred: transfer.bytesReceived,
        });
      }

      if (transfer.bytesReceived !== fileSize) {
        try {
          await sendFileControlPayload(createWireChatFileCredit(
            payload.transferId,
            myId,
            transfer.bytesReceived,
            FILE_TRANSFER_CREDIT_WINDOW_BYTES
          ));
        } catch {
          // The persisted offset is advertised after the control channel reconnects.
        }
        return;
      }

      if (transfer.writable) {
        await transfer.writable.close();
        updateFileTransfer(payload.transferId, {
          status: 'saved',
          bytesTransferred: transfer.bytesReceived,
        });
      } else {
        const blob = new Blob(transfer.chunks ?? [], { type: transfer.offer.message.file.mimeType });
        const objectUrl = URL.createObjectURL(blob);
        updateFileTransfer(payload.transferId, {
          status: 'ready',
          bytesTransferred: transfer.bytesReceived,
          file: { objectUrl },
        });
      }

      pendingFileCompletionsRef.current.set(payload.transferId, {
        from: myId,
        bytesReceived: transfer.bytesReceived,
      });
      incomingFileTransfersRef.current.delete(payload.transferId);
      incomingFileOffersRef.current.delete(payload.transferId);
      try {
        await sendFileControlPayload(createWireChatFileComplete(
          payload.transferId,
          myId,
          transfer.bytesReceived
        ));
        pendingFileCompletionsRef.current.delete(payload.transferId);
      } catch {
        // Completion is retried after the control channel reconnects.
      }
    } catch (err) {
      await transfer.writable?.abort?.().catch(() => undefined);
      incomingFileTransfersRef.current.delete(payload.transferId);
      incomingFileOffersRef.current.delete(payload.transferId);
      updateFileTransfer(payload.transferId, {
        status: 'failed',
        error: err instanceof Error ? err.message : '文件接收失败',
      });
      try {
        await sendFileControlPayload(createWireChatFileError(
          payload.transferId,
          myId,
          err instanceof Error ? err.message.slice(0, 240) : '文件接收失败'
        ));
      } catch {
        // The local failure remains visible even if the control channel is gone.
      }
    }
  }, [myId, sendFileControlPayload, updateFileTransfer]);

  const startOutgoingFileTransfer = useCallback(async (transferId: string) => {
    const transfer = outgoingFileTransfersRef.current.get(transferId);
    const conn = bulkDataConnRef.current;
    if (!transfer) return;
    if (!claimOutgoingFileTransferStart(transfer)) return;

    if (!conn?.open || !myId) {
      transfer.isStarted = false;
      return;
    }

    const session = chatCryptoSessionRef.current;
    if (!session?.isReady()) {
      transfer.isStarted = false;
      return;
    }

    const startedAt = Date.now();
    transfer.lastProgressUpdateAt = startedAt;
    transfer.lastProgressUpdateBytes = 0;
    updateFileTransfer(transferId, {
      status: 'transferring',
      bytesTransferred: 0,
    });

    try {
      while (transfer.window.nextOffset < transfer.file.size) {
        const offset = transfer.window.nextOffset;
        const bytes = await readFileSlice(transfer.file, offset);
        if (!canSendFileChunk(transfer.window, bytes.byteLength, transfer.file.size)) break;

        await sendEncryptedBinaryPayload(
          conn,
          session,
          encodeFileChunkFrame({
            transferId,
            from: myId,
            index: offset / CHAT_FILE_STREAM_CHUNK_BYTES,
            offset,
            data: bytes,
          })
        );

        transfer.window = advanceFileTransferWindow(
          transfer.window,
          bytes.byteLength,
          transfer.file.size
        );
        const bytesSent = transfer.window.nextOffset;
        const now = Date.now();
        if (shouldPublishFileTransferProgress({
          bytesTransferred: bytesSent,
          totalBytes: transfer.file.size,
          snapshot: {
            lastUpdateAt: transfer.lastProgressUpdateAt,
            lastUpdateBytes: transfer.lastProgressUpdateBytes,
          },
          now,
        })) {
          transfer.lastProgressUpdateAt = now;
          transfer.lastProgressUpdateBytes = offset;
          updateFileTransfer(transferId, {
            status: 'transferring',
            bytesTransferred: bytesSent,
          });
        }
      }

      transfer.isStarted = false;
      updateFileTransfer(transferId, {
        status: 'transferring',
        bytesTransferred: transfer.window.nextOffset,
      });
    } catch (err) {
      transfer.isStarted = false;
      if (!conn.open || conn.dataChannel?.readyState !== 'open') return;
      updateFileTransfer(transferId, {
        status: 'failed',
        error: err instanceof Error ? err.message : '文件发送失败',
      });
      outgoingFileTransfersRef.current.delete(transferId);
    }
  }, [myId, updateFileTransfer]);

  const handleDataMessage = useCallback(async (data: unknown, conn: DataConnection) => {
    if (isSessionResumePayload(data)) {
      if (isSessionResumePeerValid({
        localRole: callSessionRef.current.role,
        activeSessionId: callSessionRef.current.sessionId,
        connectionPeer: conn.peer,
        payload: data,
      })) {
        setConversationPeerId(data.peerId);
        if (myId) {
          setConversationPeers(myId, data.peerId, callSessionRef.current.sessionId);
        }
      }
      return;
    }

    if (isChatCryptoKeyMessage(data)) {
      try {
        const session = await ensureChatCryptoSession(conn);
        await session.acceptPeerPublicKey(data.publicKey);
        setIsChatSecure(true);
        for (const [transferId, transfer] of incomingFileTransfersRef.current) {
          await sendEncryptedDataPayload(conn, session, createWireChatFileCredit(
            transferId,
            myId,
            transfer.bytesReceived,
            FILE_TRANSFER_CREDIT_WINDOW_BYTES,
            true
          ));
        }
        for (const [transferId, completion] of pendingFileCompletionsRef.current) {
          await sendEncryptedDataPayload(conn, session, createWireChatFileComplete(
            transferId,
            completion.from,
            completion.bytesReceived
          ));
          pendingFileCompletionsRef.current.delete(transferId);
        }
      } catch (err) {
        console.error('Chat crypto handshake failed:', err);
        setIsChatSecure(false);
      }
      return;
    }

    if (isEncryptedChatEnvelope(data)) {
      try {
        const session = await ensureChatCryptoSession(conn);
        const payload = await session.decrypt(data);
        if (isWireChatPayload(payload)) {
          if (!isPayloadPeerValid(payload.message, conn.peer)) return;
          if (myId) {
            setConversationPeers(myId, payload.message.from, callSessionRef.current.sessionId);
          }
          addIncomingWireMessage(payload);
          return;
        }

        if (isWireChatFileOfferPayload(payload)) {
          if (!isPayloadPeerValid(payload, conn.peer)) return;
          if (myId) {
            setConversationPeers(myId, payload.from, callSessionRef.current.sessionId);
          }
          incomingFileOffersRef.current.set(payload.transferId, payload);
          addIncomingFileOffer(payload);
          return;
        }

        if (isWireChatFileAcceptPayload(payload)) {
          if (!isPayloadPeerValid(payload, conn.peer)) return;
          const transfer = outgoingFileTransfersRef.current.get(payload.transferId);
          if (!transfer) return;
          transfer.window = resumeFileTransferWindow(transfer.window, {
            persistedOffset: payload.acknowledgedOffset,
            creditBytes: payload.creditBytes,
            fileSize: transfer.file.size,
          });
          void startOutgoingFileTransfer(payload.transferId);
          return;
        }

        if (isWireChatFileCreditPayload(payload)) {
          if (!isPayloadPeerValid(payload, conn.peer)) return;
          const transfer = outgoingFileTransfersRef.current.get(payload.transferId);
          if (!transfer) return;
          transfer.window = payload.resume
            ? resumeFileTransferWindow(transfer.window, {
                persistedOffset: payload.acknowledgedOffset,
                creditBytes: payload.creditBytes,
                fileSize: transfer.file.size,
              })
            : applyFileTransferCredit(transfer.window, {
                acknowledgedOffset: payload.acknowledgedOffset,
                creditBytes: payload.creditBytes,
                fileSize: transfer.file.size,
              });
          void startOutgoingFileTransfer(payload.transferId);
          return;
        }

        if (isWireChatFileCompletePayload(payload)) {
          if (!isPayloadPeerValid(payload, conn.peer)) return;
          const transfer = outgoingFileTransfersRef.current.get(payload.transferId);
          if (!transfer || payload.bytesReceived !== transfer.file.size) return;
          updateFileTransfer(payload.transferId, {
            status: 'sent',
            bytesTransferred: payload.bytesReceived,
          });
          outgoingFileTransfersRef.current.delete(payload.transferId);
          return;
        }

        if (isWireChatFileErrorPayload(payload)) {
          if (!isPayloadPeerValid(payload, conn.peer)) return;
          outgoingFileTransfersRef.current.delete(payload.transferId);
          updateFileTransfer(payload.transferId, {
            status: 'failed',
            error: payload.message,
          });
          return;
        }

        if (isWireChatFileDeclinePayload(payload)) {
          if (!isPayloadPeerValid(payload, conn.peer)) return;
          outgoingFileTransfersRef.current.delete(payload.transferId);
          updateFileTransfer(payload.transferId, {
            status: 'rejected',
            bytesTransferred: 0,
          });
          return;
        }

      } catch (err) {
        console.error('Encrypted chat message failed:', err);
      }
      return;
    }

    if (isQualityChangePayload(data)) {
      const quality = data.quality;
      console.log('Received quality change request:', quality);
      if (quality.label !== currentQualityRef.current.label) {
        changeQuality(quality);
      }
    } else if (isHeartPayload(data)) {
      receiveHeart(data.heart);
    }
  }, [
    addIncomingFileOffer,
    addIncomingWireMessage,
    changeQuality,
    ensureChatCryptoSession,
    myId,
    receiveHeart,
    setConversationPeers,
    startOutgoingFileTransfer,
    updateFileTransfer,
  ]);

  const handleBulkDataMessage = useCallback(async (data: unknown, conn: DataConnection) => {
    if (!isEncryptedBinaryChatEnvelope(data)) return;
    const session = chatCryptoSessionRef.current;
    if (!session?.isReady()) return;

    const plaintext = await session.decryptBytes(data);
    const payload = decodeFileChunkFrame(plaintext);
    if (!isPayloadPeerValid(payload, conn.peer)) return;
    await handleIncomingFileChunk(payload);
  }, [handleIncomingFileChunk]);

  const queueDataMessage = useCallback((data: unknown, generation: number, conn: DataConnection) => {
    const next = dataMessageQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (connectionGenerationRef.current !== generation || !isCurrentConnection(dataConnRef.current, conn)) return;
        await handleDataMessage(data, conn);
      })
      .catch((err) => {
        console.error('Data message failed:', err);
      });
    dataMessageQueueRef.current = next;
  }, [handleDataMessage]);

  const queueBulkDataMessage = useCallback((data: unknown, generation: number, conn: DataConnection) => {
    const next = bulkMessageQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (connectionGenerationRef.current !== generation || !isCurrentConnection(bulkDataConnRef.current, conn)) return;
        await handleBulkDataMessage(data, conn);
      })
      .catch((err) => {
        console.error('Bulk data message failed:', err);
      });
    bulkMessageQueueRef.current = next;
  }, [handleBulkDataMessage]);

  const closeCurrentBulkDataConnection = useCallback(() => {
    const conn = bulkDataConnRef.current;
    bulkDataConnRef.current = null;
    conn?.close();
  }, []);

  const resetDataConnection = useCallback((abortTransfers = false) => {
    resetChatCryptoState();
    dataMessageQueueRef.current = Promise.resolve();
    bulkMessageQueueRef.current = Promise.resolve();
    for (const transfer of outgoingFileTransfersRef.current.values()) {
      transfer.isStarted = false;
    }

    if (abortTransfers) {
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
      acceptingFileTransfersRef.current.clear();
      incomingFileTransfersRef.current.clear();
      pendingFileCompletionsRef.current.clear();
    }
    setIsDataConnected(false);
    setIsChatSecure(false);
  }, [resetChatCryptoState, updateFileTransfer]);

  useEffect(() => {
    const outgoingTransfers = outgoingFileTransfersRef.current;
    const incomingOffers = incomingFileOffersRef.current;
    const acceptingTransfers = acceptingFileTransfersRef.current;
    const incomingTransfers = incomingFileTransfersRef.current;
    const pendingCompletions = pendingFileCompletionsRef.current;

    return () => {
      for (const transfer of incomingTransfers.values()) {
        void transfer.writable?.abort?.();
      }
      outgoingTransfers.clear();
      incomingOffers.clear();
      acceptingTransfers.clear();
      incomingTransfers.clear();
      pendingCompletions.clear();
    };
  }, []);

  const closeCurrentDataConnection = useCallback(() => {
    const conn = dataConnRef.current;
    dataConnRef.current = null;
    conn?.close();
    closeCurrentBulkDataConnection();
  }, [closeCurrentBulkDataConnection]);

  const scheduleDataReconnect = useCallback(() => {
    if (!reconnectEnabledRef.current || !shouldInitiateOutgoingConnection({
      role: callSessionRef.current.role,
      remotePeerId,
    })) return;

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

  const scheduleMediaReconnect = useCallback(() => {
    if (!reconnectEnabledRef.current || !shouldInitiateOutgoingConnection({
      role: callSessionRef.current.role,
      remotePeerId,
    })) return;

    setMediaReconnectCount((count) => {
      const delayMs = dataReconnectDelayMs(count);
      if (delayMs === null) return count;

      if (mediaReconnectTimerRef.current) {
        clearTimeout(mediaReconnectTimerRef.current);
      }
      mediaReconnectTimerRef.current = setTimeout(() => {
        mediaReconnectTimerRef.current = null;
        setReconnectAttempt((attempt) => attempt + 1);
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
        sendDataConnectionPayload(conn, createSessionResumeMessage({
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
        closeCurrentBulkDataConnection();
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
    closeCurrentBulkDataConnection,
    myId,
    queueDataMessage,
    resetChatCryptoState,
    resetDataConnection,
    scheduleDataReconnect,
    setConversationPeers,
  ]);

  const setupBulkDataConnection = useCallback((
    conn: DataConnection,
    generation = connectionGenerationRef.current
  ) => {
    bulkDataConnRef.current = conn;

    const handleOpen = () => {
      if (connectionGenerationRef.current !== generation || !isCurrentConnection(bulkDataConnRef.current, conn)) return;
      setDataReconnectCount(0);
      for (const [transferId, transfer] of outgoingFileTransfersRef.current) {
        if (transfer.window.nextOffset === transfer.window.acknowledgedOffset) {
          void startOutgoingFileTransfer(transferId);
        }
      }
      for (const [transferId, transfer] of incomingFileTransfersRef.current) {
        void sendFileControlPayload(createWireChatFileCredit(
          transferId,
          myId,
          transfer.bytesReceived,
          FILE_TRANSFER_CREDIT_WINDOW_BYTES,
          true
        )).catch(() => undefined);
      }
    };

    const handleClose = () => {
      if (connectionGenerationRef.current !== generation) return;
      if (isCurrentConnection(bulkDataConnRef.current, conn)) {
        bulkDataConnRef.current = null;
        for (const transfer of outgoingFileTransfersRef.current.values()) {
          transfer.isStarted = false;
        }
        scheduleDataReconnect();
      }
    };

    conn.on('open', handleOpen);
    conn.on('data', (data: unknown) => {
      if (connectionGenerationRef.current !== generation || !isCurrentConnection(bulkDataConnRef.current, conn)) return;
      queueBulkDataMessage(data, generation, conn);
    });
    conn.on('close', handleClose);
    conn.on('error', (err) => {
      console.error('Bulk data connection error:', err);
      handleClose();
    });

    if (conn.open) handleOpen();
  }, [
    myId,
    queueBulkDataMessage,
    scheduleDataReconnect,
    sendFileControlPayload,
    startOutgoingFileTransfer,
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
    if (!isPeerReady || !stream || !shouldInitiateOutgoingConnection({
      role: callSession.role,
      remotePeerId,
    })) return;
    
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
          setMediaReconnectCount(0);
          if (mediaReconnectTimerRef.current) {
            clearTimeout(mediaReconnectTimerRef.current);
            mediaReconnectTimerRef.current = null;
          }
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
          scheduleMediaReconnect();
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
            scheduleMediaReconnect();
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
    if (!bulkDataConnRef.current) {
      const conn = connectToPeer(remotePeerId, createConnectionMetadata(), 'bulk');
      if (conn) {
        setupBulkDataConnection(conn, connectionGenerationRef.current);
      }
    }
  }, [
    isPeerReady,
    stream,
    callSession.role,
    remotePeerId,
    callPeer,
    connectToPeer,
    createConnectionMetadata,
    attachPeerConnectionDebug,
    closeCurrentDataConnection,
    resetConnectionStats,
    resetDataConnection,
    scheduleMediaReconnect,
    setupDataConnection,
    setupBulkDataConnection,
    reconnectAttempt,
    dataReconnectAttempt,
  ]);

  // 2. Register incoming listeners so same-session refreshes can replace old connections.
  // Register listeners immediately when Peer is ready, do NOT wait for stream.
  useEffect(() => {
    if (!isPeerReady) return;

    if (callSession.role === 'host') {
      setConnectionStatus('waiting');
    }

    onIncomingCall((call) => {
      console.log('Incoming call received');
      if (!isIncomingConnectionMetadataValid({
        localRole: callSessionRef.current.role,
        activeSessionId: callSessionRef.current.sessionId,
        connectionPeer: call.peer,
        metadata: call.metadata,
      })) {
        call.close();
        return;
      }
      const metadata = call.metadata as { turnMode?: string } | undefined;
      if (metadata?.turnMode && metadata.turnMode !== 'off') {
        enableTurnFallback();
      }
      if (callRef.current) {
        const currentTransportState = callRef.current.peerConnection?.connectionState ?? '';
        if (!shouldReplaceCurrentMediaConnection({
          hasCurrentConnection: true,
          currentTransportState,
        })) {
          call.close();
          return;
        }
        closeActiveConnections();
      }
      setConversationPeerId(call.peer);
      setIncomingCall(call);
      setConnectionStatus('connecting');
    });

    onIncomingData((conn) => {
      console.log('Incoming data connection received');
      if (!isIncomingConnectionMetadataValid({
        localRole: callSessionRef.current.role,
        activeSessionId: callSessionRef.current.sessionId,
        connectionPeer: conn.peer,
        metadata: conn.metadata,
      })) {
        conn.close();
        return;
      }
      const channel = getDataConnectionChannel(conn.metadata);
      if (!channel) {
        conn.close();
        return;
      }
      const metadata = conn.metadata as { turnMode?: string } | undefined;
      if (metadata?.turnMode && metadata.turnMode !== 'off') {
        enableTurnFallback();
      }
      if (channel === 'bulk') {
        if (bulkDataConnRef.current && bulkDataConnRef.current !== conn) {
          if (bulkDataConnRef.current.open) {
            conn.close();
            return;
          }
          const previousConn = bulkDataConnRef.current;
          bulkDataConnRef.current = null;
          previousConn.close();
        }
        setupBulkDataConnection(conn, connectionGenerationRef.current);
        return;
      }
      if (dataConnRef.current && dataConnRef.current !== conn) {
        if (!shouldReplaceCurrentDataConnection({
          hasCurrentConnection: true,
          isCurrentOpen: dataConnRef.current.open,
        })) {
          conn.close();
          return;
        }

        const previousConn = dataConnRef.current;
        dataConnRef.current = null;
        resetDataConnection();
        previousConn.close();
      }
      setupDataConnection(conn, connectionGenerationRef.current);
    });
  }, [
    closeActiveConnections,
    callSession.role,
    enableTurnFallback,
    isPeerReady,
    onIncomingCall,
    onIncomingData,
    remotePeerId,
    resetDataConnection,
    setupDataConnection,
    setupBulkDataConnection,
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
      if (callSessionRef.current.role === 'host') {
        setConnectionStatus('waiting');
      }
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
      if (callSessionRef.current.role === 'host') {
        setConnectionStatus('waiting');
      }
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
          isStarted: false,
          window: createFileTransferSendWindow(file.size),
          lastProgressUpdateAt: 0,
          lastProgressUpdateBytes: 0,
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

    if (incomingFileTransfersRef.current.has(messageId) || acceptingFileTransfersRef.current.has(messageId)) return;
    acceptingFileTransfersRef.current.add(messageId);

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
        lastProgressUpdateAt: Date.now(),
        lastProgressUpdateBytes: 0,
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
      await sendEncryptedDataPayload(conn, session, createWireChatFileAccept(
        messageId,
        myId,
        saveMode,
        FILE_TRANSFER_CREDIT_WINDOW_BYTES
      ));
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
    } finally {
      acceptingFileTransfersRef.current.delete(messageId);
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
    acceptingFileTransfersRef.current.delete(messageId);
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
    reconnectEnabledRef.current = false;
    if (mediaReconnectTimerRef.current) clearTimeout(mediaReconnectTimerRef.current);
    if (dataReconnectTimerRef.current) clearTimeout(dataReconnectTimerRef.current);
    if (callRef.current) {
      callRef.current.close();
    }
    closeCurrentDataConnection();
    resetDataConnection(true);
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
  const controlsVisible = showControls || isChatOpen || isMobileMoreOpen;

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

      {isMobileMoreOpen && (
        <div
          ref={mobileMorePanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="更多通话选项"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsMobileMoreOpen(false);
          }}
          className={cn(
            "absolute inset-x-4 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-[60] rounded-2xl border border-gray-700 bg-gray-900/95 p-3 text-white shadow-2xl backdrop-blur-md transition-all duration-300 ease-in-out md:hidden",
            controlsVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 pointer-events-none"
          )}
        >
          <div className="space-y-3">
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-gray-700 bg-gray-800 px-3 text-left text-sm text-gray-100 hover:bg-gray-700"
              onClick={() => setIsRemoteMuted((value) => !value)}
              aria-pressed={!isRemoteMuted}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-700">
                {isRemoteMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">对方声音</span>
                <span className="block text-xs text-gray-400">{isRemoteMuted ? '已静音' : '已开启'}</span>
              </span>
            </button>

            <div className="rounded-xl border border-gray-700 bg-gray-800 p-3 text-sm text-gray-100">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="font-medium">显示模式</span>
                <div className="grid grid-cols-2 rounded-lg border border-gray-700 bg-gray-900 p-0.5">
                  <button
                    type="button"
                    className={cn(
                      "min-h-9 rounded-md px-3 text-xs font-medium",
                      videoFitMode === 'cover' ? "bg-blue-600 text-white" : "text-gray-300"
                    )}
                    onClick={() => setVideoFitMode('cover')}
                  >
                    填满
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "min-h-9 rounded-md px-3 text-xs font-medium",
                      videoFitMode === 'contain' ? "bg-blue-600 text-white" : "text-gray-300"
                    )}
                    onClick={() => setVideoFitMode('contain')}
                  >
                    适应
                  </button>
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block font-medium">视频画质</span>
                <select
                  className="h-10 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 text-sm text-white outline-none focus:border-blue-500"
                  value={currentQuality.label}
                  disabled={!stream}
                  onChange={(event) => {
                    const nextQuality = VIDEO_QUALITIES.find((quality) => quality.label === event.target.value);
                    if (nextQuality) {
                      void handleQualityChange(nextQuality);
                    }
                  }}
                >
                  {VIDEO_QUALITIES.map((quality) => (
                    <option key={quality.label} value={quality.label}>
                      {quality.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}

      <CallControls
        visible={controlsVisible}
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        isRemoteMuted={isRemoteMuted}
        isChatOpen={isChatOpen}
        isMobileMoreOpen={isMobileMoreOpen}
        unreadCount={unreadChatCount}
        streamAvailable={Boolean(stream)}
        currentQuality={currentQuality}
        videoFitMode={videoFitMode}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleRemoteAudio={() => setIsRemoteMuted((value) => !value)}
        onQualityChange={(quality) => void handleQualityChange(quality)}
        onVideoFitModeChange={setVideoFitMode}
        onToggleChat={() => setIsChatOpen((value) => !value)}
        onOpenChat={() => {
          setIsMobileMoreOpen(false);
          setIsChatOpen(true);
        }}
        onToggleMobileMore={() => {
          setIsChatOpen(false);
          setIsMobileMoreOpen((value) => !value);
        }}
        onEndCall={endCall}
      />

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
