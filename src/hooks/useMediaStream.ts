import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createMediaStreamLifecycle,
  type MediaStreamLifecycle,
} from '../lib/mediaStreamLifecycle';

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
  { label: '1080p (Full HD)', width: 1920, height: 1080, frameRate: 30 },
  { label: '4K (Ultra HD)', width: 3840, height: 2160, frameRate: 24 },
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
  const lifecycleRef = useRef<MediaStreamLifecycle<MediaStream> | null>(null);
  const audioEnabledRef = useRef(true);
  const videoEnabledRef = useRef(true);

  if (!lifecycleRef.current) {
    lifecycleRef.current = createMediaStreamLifecycle<MediaStream>();
  }

  const lifecycle = lifecycleRef.current;

  const initializeStream = useCallback(async (quality: VideoQuality = VIDEO_QUALITIES[0]) => {
    const requestGeneration = lifecycle.beginRequest();

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
      
      // Apply saved enabled state to new tracks
      stream.getAudioTracks().forEach(track => {
        track.enabled = audioEnabledRef.current;
      });
      stream.getVideoTracks().forEach(track => {
        track.enabled = videoEnabledRef.current;
      });

      if (!lifecycle.commit(requestGeneration, stream)) {
        return null;
      }

      setCurrentQuality(quality);
      setState(prev => ({
        ...prev, 
        stream, 
        error: null,
        isAudioEnabled: audioEnabledRef.current,
        isVideoEnabled: videoEnabledRef.current
      }));
      return stream;
    } catch (err) {
      if (lifecycle.isCurrent(requestGeneration)) {
        console.error('Error accessing media devices:', err);
        setState(prev => ({ ...prev, error: err as Error }));
      }
      return null;
    }
  }, [lifecycle]);

  const changeQuality = useCallback(async (quality: VideoQuality) => {
    return initializeStream(quality);
  }, [initializeStream]);

  const toggleAudio = useCallback(() => {
    const stream = lifecycle.current();
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        audioEnabledRef.current = audioTrack.enabled;
        setState(prev => ({ ...prev, isAudioEnabled: audioTrack.enabled }));
      }
    }
  }, [lifecycle]);

  const toggleVideo = useCallback(() => {
    const stream = lifecycle.current();
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        videoEnabledRef.current = videoTrack.enabled;
        setState(prev => ({ ...prev, isVideoEnabled: videoTrack.enabled }));
      }
    }
  }, [lifecycle]);

  const cleanup = useCallback(() => {
    lifecycle.cleanup();
    audioEnabledRef.current = true;
    videoEnabledRef.current = true;
    setState({
      stream: null,
      error: null,
      isAudioEnabled: true,
      isVideoEnabled: true,
    });
  }, [lifecycle]);

  useEffect(() => {
    return () => {
      lifecycle.cleanup();
    };
  }, [lifecycle]);

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
