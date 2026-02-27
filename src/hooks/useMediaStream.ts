import { useState, useEffect, useCallback, useRef } from 'react';

interface MediaStreamState {
  stream: MediaStream | null;
  error: Error | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
}

export interface VideoQuality {
  width: number;
  height: number;
  frameRate: number;
  label: string;
}

export const VIDEO_QUALITIES: VideoQuality[] = [
  { label: '720p (HD)', width: 1280, height: 720, frameRate: 30 },
  { label: '480p (SD)', width: 640, height: 480, frameRate: 30 },
  { label: '360p (Low)', width: 480, height: 360, frameRate: 24 },
];

export function useMediaStream() {
  const [state, setState] = useState<MediaStreamState>({
    stream: null,
    error: null,
    isAudioEnabled: true,
    isVideoEnabled: true,
  });
  
  const [currentQuality, setCurrentQuality] = useState<VideoQuality>(VIDEO_QUALITIES[0]);
  const streamRef = useRef<MediaStream | null>(null);

  const initializeStream = useCallback(async (quality: VideoQuality = VIDEO_QUALITIES[0]) => {
    // Stop existing tracks if any
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.frameRate },
          facingMode: 'user'
        },
        audio: true,
      });
      
      streamRef.current = stream;
      setCurrentQuality(quality);
      setState(prev => ({ 
        ...prev, 
        stream, 
        error: null,
        // Reset toggle states based on new stream tracks
        isAudioEnabled: stream.getAudioTracks()[0]?.enabled ?? false,
        isVideoEnabled: stream.getVideoTracks()[0]?.enabled ?? false
      }));
      return stream;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      setState(prev => ({ ...prev, error: err as Error }));
      return null;
    }
  }, []);

  const changeQuality = useCallback(async (quality: VideoQuality) => {
    return initializeStream(quality);
  }, [initializeStream]);

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
    currentQuality,
    initializeStream,
    changeQuality,
    toggleAudio,
    toggleVideo,
    cleanup,
  };
}
