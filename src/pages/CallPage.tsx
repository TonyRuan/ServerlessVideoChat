import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Video, Mic, MicOff, VideoOff, PhoneOff, Copy, Share2, Loader2, Volume2, VolumeX, MessageCircle } from 'lucide-react';
import type { MediaConnection, DataConnection } from 'peerjs';
import { Button } from '../components/Button';
import { SettingsMenu, type VideoFitMode } from '../components/SettingsMenu';
import { ChatPanel } from '../components/ChatPanel';
import { useMediaStream, type VideoQuality } from '../hooks/useMediaStream';
import { usePeer } from '../hooks/usePeer';
import { useHeartStore, type HeartData } from '../stores/heartStore';
import { useChatStore } from '../stores/chatStore';
import type { ChatImageAttachment } from '../lib/chatStorage';
import {
  createChatCryptoSession,
  isChatCryptoKeyMessage,
  isEncryptedChatEnvelope,
  type ChatCryptoSession,
} from '../lib/chatCrypto';
import { createWireChatMessage, isWireChatPayload } from '../lib/chatProtocol';
import { cn } from '../lib/utils';

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
  const { myId, isPeerReady, error: peerError, callPeer, connectToPeer, onIncomingCall, onIncomingData } = usePeer();
  
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'initializing' | 'waiting' | 'connecting' | 'connected' | 'disconnected'>('initializing');
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
  const [inboundAudioBytes, setInboundAudioBytes] = useState<number | null>(null);
  const [remotePlayError, setRemotePlayError] = useState<string>('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isDataConnected, setIsDataConnected] = useState(false);
  const [isChatSecure, setIsChatSecure] = useState(false);
  const [conversationPeerId, setConversationPeerId] = useState<string | null>(remotePeerId ?? null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const currentQualityRef = useRef(currentQuality);
  const pcCleanupRef = useRef<(() => void) | null>(null);
  const chatCryptoSessionRef = useRef<ChatCryptoSession | null>(null);
  const chatCryptoSessionPromiseRef = useRef<Promise<ChatCryptoSession> | null>(null);
  const chatCryptoPublicKeySentRef = useRef(false);
  
  // Heart store
  const outgoingHeart = useHeartStore(state => state.outgoingHeart);
  const receiveHeart = useHeartStore(state => state.receiveHeart);
  const unreadChatCount = useChatStore(state => state.unreadCount);
  const setChatPanelOpen = useChatStore(state => state.setPanelOpen);
  const setConversationPeers = useChatStore(state => state.setConversationPeers);
  const createLocalMessage = useChatStore(state => state.createLocalMessage);
  const addIncomingWireMessage = useChatStore(state => state.addIncomingWireMessage);
  const updateMessageStatus = useChatStore(state => state.updateMessageStatus);

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
    setConversationPeers(myId, conversationPeerId);
  }, [myId, conversationPeerId, setConversationPeers]);

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

  const handleDataMessage = useCallback(async (data: unknown) => {
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
            setConversationPeers(myId, payload.message.from);
          }
          addIncomingWireMessage(payload);
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
  }, [addIncomingWireMessage, changeQuality, ensureChatCryptoSession, myId, receiveHeart, setConversationPeers]);

  const resetDataConnection = useCallback(() => {
    resetChatCryptoState();
    setIsDataConnected(false);
    setIsChatSecure(false);
  }, [resetChatCryptoState]);

  const setupDataConnection = useCallback((conn: DataConnection) => {
    resetChatCryptoState();
    dataConnRef.current = conn;
    setConversationPeerId(conn.peer);
    if (myId) {
      setConversationPeers(myId, conn.peer);
    }

    const handleOpen = () => {
      setIsDataConnected(true);
      void ensureChatCryptoSession(conn).catch((err) => {
        console.error('Unable to start chat crypto session:', err);
        setIsChatSecure(false);
      });
    };

    const handleClose = () => {
      if (dataConnRef.current === conn) {
        dataConnRef.current = null;
        resetDataConnection();
      }
    };

    conn.on('open', handleOpen);
    conn.on('data', (data: unknown) => {
      void handleDataMessage(data);
    });
    conn.on('close', handleClose);
    conn.on('error', (err) => {
      console.error('Data connection error:', err);
      handleClose();
    });

    if (conn.open) {
      handleOpen();
    }
  }, [ensureChatCryptoSession, handleDataMessage, myId, resetChatCryptoState, resetDataConnection, setConversationPeers]);

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
    if (remotePeerId) return;
    if (!myId) return;

    const raw = `${location.search ?? ''} ${location.hash ?? ''}`;
    const match = raw.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
    if (!match) return;

    const extractedPeerId = match[0];
    if (extractedPeerId === myId) return;

    navigate(`/call/${extractedPeerId}`, { replace: true });
  }, [remotePeerId, myId, location.search, location.hash, navigate]);

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
        let videoBytes = 0;
        let audioBytes = 0;
        let hasVideo = false;
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
          if (kind === 'video') {
            hasVideo = true;
            videoBytes += r.bytesReceived ?? 0;
          } else if (kind === 'audio') {
            hasAudio = true;
            audioBytes += r.bytesReceived ?? 0;
          }
        });

        setInboundVideoBytes(hasVideo ? videoBytes : null);
        setInboundAudioBytes(hasAudio ? audioBytes : null);
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
      const call = callPeer(remotePeerId, stream);
      
      if (call) {
        callRef.current = call;
        attachPeerConnectionDebug(call.peerConnection);
        call.on('stream', (remoteStream) => {
          setRemoteStream(remoteStream);
          setConnectionStatus('connected');
        });
        
        call.on('close', () => {
          setConnectionStatus('disconnected');
          setRemoteStream(null);
          dataConnRef.current?.close();
          callRef.current = null;
          dataConnRef.current = null;
          resetDataConnection();
          attachPeerConnectionDebug(null);
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
            setConnectionStatus('disconnected');
        });
      }
    }

    // Also establish data connection if not exists
    if (!dataConnRef.current) {
      const conn = connectToPeer(remotePeerId);
      if (conn) {
        setupDataConnection(conn);
      }
    }
  }, [isPeerReady, stream, remotePeerId, callPeer, connectToPeer, attachPeerConnectionDebug, resetDataConnection, setupDataConnection]);

  // 2. Callee logic - Register listeners (Signaling)
  // Register listeners immediately when Peer is ready, do NOT wait for stream
  useEffect(() => {
    if (!isPeerReady || remotePeerId) return; // Only if we are callee (no remotePeerId)
    
    // We are waiting for a call
    setConnectionStatus('waiting');
    
    onIncomingCall((call) => {
      console.log('Incoming call received');
      if (callRef.current) {
        call.close();
        return;
      }
      setConversationPeerId(call.peer);
      setIncomingCall(call);
      setConnectionStatus('connecting');
    });

    onIncomingData((conn) => {
      console.log('Incoming data connection received');
      if (dataConnRef.current && dataConnRef.current.open) {
        conn.close();
        return;
      }
      setupDataConnection(conn);
    });
  }, [isPeerReady, remotePeerId, onIncomingCall, onIncomingData, setupDataConnection]);

  // 3. Callee logic - Handle incoming call events
  useEffect(() => {
    if (!incomingCall) return;

    // Register listeners immediately
    attachPeerConnectionDebug(incomingCall.peerConnection);
    incomingCall.on('stream', (remoteStream) => {
      console.log('Received remote stream');
      setRemoteStream(remoteStream);
      setConnectionStatus('connected');
    });

    incomingCall.on('close', () => {
      setConnectionStatus('disconnected');
      setRemoteStream(null);
      dataConnRef.current?.close();
      callRef.current = null;
      dataConnRef.current = null;
      setIncomingCall(null);
      resetDataConnection();
      attachPeerConnectionDebug(null);
    });

    incomingCall.on('error', (err) => {
      console.error('Incoming call error:', err);
      setConnectionStatus('disconnected');
    });

    return () => {
      // Cleanup listeners if needed? PeerJS handles this on close
    };
  }, [incomingCall, attachPeerConnectionDebug, resetDataConnection]);

  // 4. Callee logic - Answer call (Stream handling)
  // Answer call when stream becomes available
  useEffect(() => {
    if (!incomingCall || !stream) return;
    if (callRef.current === incomingCall) return; // Already answered

    console.log('Answering incoming call with stream');
    incomingCall.answer(stream);
    callRef.current = incomingCall;
    attachPeerConnectionDebug(incomingCall.peerConnection);
  }, [incomingCall, stream, attachPeerConnectionDebug]);

  const handleSendChat = useCallback(async ({ text, image }: { text?: string; image?: ChatImageAttachment }) => {
    if (!myId) {
      throw new Error('Peer 尚未就绪');
    }

    const message = createLocalMessage({ myPeerId: myId, text, image });
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
      const encrypted = await session.encrypt(createWireChatMessage(message, myId));
      conn.send(encrypted);
      updateMessageStatus(message.id, 'sent');
    } catch (err) {
      updateMessageStatus(message.id, 'failed');
      throw err instanceof Error ? err : new Error('发送失败');
    }
  }, [createLocalMessage, ensureChatCryptoSession, myId, updateMessageStatus]);

  const copyLink = () => {
    const baseUrl = window.location.origin + import.meta.env.BASE_URL;
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const link = `${cleanBaseUrl}/call/${myId}`;
    
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inviteLink = (() => {
    const baseUrl = window.location.origin + import.meta.env.BASE_URL;
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${cleanBaseUrl}/call/${myId}`;
  })();

  const endCall = () => {
    if (callRef.current) {
      callRef.current.close();
    }
    if (dataConnRef.current) {
      dataConnRef.current.close();
      dataConnRef.current = null;
      resetDataConnection();
    }
    navigate('/');
  };

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
          </>
        ) : (
          <div className="text-center space-y-4 p-4">
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

            {rtcIceState === 'failed' && (
              <p className="text-sm text-amber-400">
                当前网络环境直连失败，通常需要配置 TURN 中继服务才能跨设备稳定通话。
              </p>
            )}
            
            {connectionStatus === 'waiting' && myId && (
              <div className="mt-8 p-6 bg-gray-800 rounded-xl max-w-md mx-auto border border-gray-700">
                <p className="text-gray-400 mb-2 text-sm">分享此链接邀请他人</p>
                <div className="flex gap-2">
                  <input 
                    readOnly 
                    value={inviteLink}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none"
                  />
                  <Button onClick={copyLink} variant="secondary" size="icon">
                    {copied ? <Share2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
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
        onClose={() => setIsChatOpen(false)}
        onSend={handleSendChat}
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
      
      {/* Connection Status Badge */}
      <div className="absolute top-4 left-4 px-3 py-2 bg-gray-800/80 backdrop-blur rounded-xl text-xs font-medium text-gray-300 border border-gray-700">
        <div className="flex items-center gap-2">
        <span className={cn(
          "w-2 h-2 rounded-full",
          connectionStatus === 'connected' ? "bg-green-500" :
          connectionStatus === 'disconnected' ? "bg-red-500" :
          "bg-yellow-500 animate-pulse"
        )} />
        {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
        </div>
        <div className="mt-1 text-[11px] text-gray-400">
          ICE: {rtcIceState || '-'} / PC: {rtcConnectionState || '-'}
        </div>
        <div className="mt-1 text-[11px] text-gray-400">
          V: {remoteStream ? remoteStream.getVideoTracks().length : 0} / A: {remoteStream ? remoteStream.getAudioTracks().length : 0}
          {' '}· Size: {remoteVideoWidth}x{remoteVideoHeight} · RS: {remoteVideoReadyState} · {remoteVideoPaused ? 'paused' : 'playing'}
        </div>
        <div className="mt-1 text-[11px] text-gray-400">
          In: video {inboundVideoBytes ?? '-'} / audio {inboundAudioBytes ?? '-'}
        </div>
        {remotePlayError && (
          <div className="mt-1 text-[11px] text-amber-400">
            Play: {remotePlayError}
          </div>
        )}
      </div>
    </div>
  );
}
