import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Video, Mic, MicOff, VideoOff, PhoneOff, Copy, Share2, Loader2 } from 'lucide-react';
import type { MediaConnection } from 'peerjs';
import { Button } from '../components/Button';
import { SettingsMenu, type VideoFitMode } from '../components/SettingsMenu';
import { useMediaStream } from '../hooks/useMediaStream';
import { usePeer } from '../hooks/usePeer';
import { cn } from '../lib/utils';

export default function CallPage() {
  const { remotePeerId } = useParams<{ remotePeerId: string }>();
  const navigate = useNavigate();
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
  const { myId, isPeerReady, error: peerError, callPeer, onIncomingCall } = usePeer();
  
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'initializing' | 'waiting' | 'connecting' | 'connected' | 'disconnected'>('initializing');
  const [copied, setCopied] = useState(false);
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>('cover');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callRef = useRef<MediaConnection | null>(null);

  // Initialize local stream
  useEffect(() => {
    initializeStream();
    return () => cleanup();
  }, [initializeStream, cleanup]);

  // Handle local video stream
  useEffect(() => {
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Handle remote video stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Handle connection logic
  useEffect(() => {
    if (!isPeerReady || !stream) return;

    if (remotePeerId) {
      // We are the caller
      setConnectionStatus('connecting');
      const call = callPeer(remotePeerId, stream);
      
      if (call) {
        callRef.current = call;
        call.on('stream', (remoteStream) => {
          setRemoteStream(remoteStream);
          setConnectionStatus('connected');
        });
        
        call.on('close', () => {
          setConnectionStatus('disconnected');
          setRemoteStream(null);
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
            setConnectionStatus('disconnected');
        });
      }
    } else {
      // We are waiting for a call
      setConnectionStatus('waiting');
      
      onIncomingCall((call) => {
        setConnectionStatus('connecting');
        call.answer(stream);
        callRef.current = call;
        
        call.on('stream', (remoteStream) => {
          setRemoteStream(remoteStream);
          setConnectionStatus('connected');
        });

        call.on('close', () => {
          setConnectionStatus('disconnected');
          setRemoteStream(null);
        });
      });
    }
  }, [isPeerReady, stream, remotePeerId, callPeer, onIncomingCall]);

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
    navigate('/');
  };

  if (streamError || peerError) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-500 text-xl">An error occurred</p>
          <p className="text-gray-400">{streamError?.message || peerError?.message}</p>
          <Button onClick={() => navigate('/')}>Go Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white overflow-hidden relative">
      {/* Remote Video (Full Screen) */}
      <div className="absolute inset-0 flex items-center justify-center">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center space-y-4 p-4">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-800 animate-pulse">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            </div>
            <h2 className="text-2xl font-semibold">
              {connectionStatus === 'waiting' ? 'Waiting for someone to join...' : 
               connectionStatus === 'connecting' ? 'Connecting...' : 
               'Initializing...'}
            </h2>
            
            {connectionStatus === 'waiting' && myId && (
              <div className="mt-8 p-6 bg-gray-800 rounded-xl max-w-md mx-auto border border-gray-700">
                <p className="text-gray-400 mb-2 text-sm">Share this link to invite others</p>
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



      {/* Controls Bar */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 px-8 py-4 bg-gray-800/90 backdrop-blur-sm rounded-full shadow-2xl border border-gray-700">
        <Button
          variant={isAudioEnabled ? 'secondary' : 'danger'}
          size="icon"
          className="rounded-full h-14 w-14"
          onClick={toggleAudio}
        >
          {isAudioEnabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
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
            onQualityChange={changeQuality}
            videoFitMode={videoFitMode}
            onVideoFitModeChange={setVideoFitMode}
            disabled={!stream}
          />
          
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
      <div className="absolute top-4 left-4 px-3 py-1 bg-gray-800/80 backdrop-blur rounded-full text-xs font-medium text-gray-300 border border-gray-700 flex items-center gap-2">
        <span className={cn(
          "w-2 h-2 rounded-full",
          connectionStatus === 'connected' ? "bg-green-500" :
          connectionStatus === 'disconnected' ? "bg-red-500" :
          "bg-yellow-500 animate-pulse"
        )} />
        {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
      </div>
    </div>
  );
}
