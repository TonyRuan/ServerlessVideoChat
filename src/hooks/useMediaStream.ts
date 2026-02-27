import { useState, useEffect, useCallback, useRef } from 'react';

interface MediaStreamState {
  stream: MediaStream | null;
  error: Error | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
}

export function useMediaStream() {
  const [state, setState] = useState<MediaStreamState>({
    stream: null,
    error: null,
    isAudioEnabled: true,
    isVideoEnabled: true,
  });
  
  const streamRef = useRef<MediaStream | null>(null);

  const initializeStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      
      streamRef.current = stream;
      setState(prev => ({ ...prev, stream, error: null }));
      return stream;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      setState(prev => ({ ...prev, error: err as Error }));
      return null;
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setState(prev => ({ ...prev, isAudioEnabled: audioTrack.enabled }));
      }
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setState(prev => ({ ...prev, isVideoEnabled: videoTrack.enabled }));
      }
    }
  }, []);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setState({
        stream: null,
        error: null,
        isAudioEnabled: true,
        isVideoEnabled: true,
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    ...state,
    initializeStream,
    toggleAudio,
    toggleVideo,
    cleanup,
  };
}
