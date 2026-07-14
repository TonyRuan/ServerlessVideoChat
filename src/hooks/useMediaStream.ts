import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createMediaStreamLifecycle,
  type MediaStreamLifecycle,
} from '../lib/mediaStreamLifecycle';
import type { CallMediaDefaults } from '../lib/callSession';
import {
  addDisabledPlaceholderTracks,
  buildMediaStreamConstraints,
  isPlaceholderMediaTrack,
} from '../lib/mediaDevicePolicy';

interface MediaStreamState {
  stream: MediaStream | null;
  error: Error | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isAudioPending: boolean;
  isVideoPending: boolean;
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

export type PlaceholderTrackReplacer = (
  kind: 'audio' | 'video',
  replacement: MediaStreamTrack,
  placeholder: MediaStreamTrack
) => Promise<void>;

export function useMediaStream() {
  const [state, setState] = useState<MediaStreamState>({
    stream: null,
    error: null,
    isAudioEnabled: true,
    isVideoEnabled: true,
    isAudioPending: false,
    isVideoPending: false,
  });

  const [currentQuality, setCurrentQuality] = useState<VideoQuality>(VIDEO_QUALITIES[0]);
  const lifecycleRef = useRef<MediaStreamLifecycle<MediaStream> | null>(null);
  const audioEnabledRef = useRef(true);
  const videoEnabledRef = useRef(true);
  const pendingTrackRequestsRef = useRef<Record<'audio' | 'video', Promise<boolean> | null>>({
    audio: null,
    video: null,
  });

  if (!lifecycleRef.current) {
    lifecycleRef.current = createMediaStreamLifecycle<MediaStream>();
  }

  const lifecycle = lifecycleRef.current;

  const initializeStream = useCallback(async (
    quality: VideoQuality = VIDEO_QUALITIES[0],
    mediaDefaults?: CallMediaDefaults
  ) => {
    const requestGeneration = lifecycle.beginRequest();
    const effectiveDefaults = mediaDefaults ?? {
      audioEnabled: audioEnabledRef.current,
      videoEnabled: videoEnabledRef.current,
    };
    audioEnabledRef.current = effectiveDefaults.audioEnabled;
    videoEnabledRef.current = effectiveDefaults.videoEnabled;
    let stream: MediaStream | null = null;

    try {
      const constraints = buildMediaStreamConstraints(quality, effectiveDefaults);
      stream = constraints
        ? await navigator.mediaDevices.getUserMedia(constraints)
        : new MediaStream();
      addDisabledPlaceholderTracks(stream, effectiveDefaults);

      stream.getAudioTracks().forEach(track => {
        track.enabled = effectiveDefaults.audioEnabled;
      });
      stream.getVideoTracks().forEach(track => {
        track.enabled = effectiveDefaults.videoEnabled;
      });

      if (!lifecycle.commit(requestGeneration, stream)) {
        return null;
      }

      setCurrentQuality(quality);
      setState(prev => ({
        ...prev,
        stream,
        error: null,
        isAudioEnabled: effectiveDefaults.audioEnabled,
        isVideoEnabled: effectiveDefaults.videoEnabled,
      }));
      return stream;
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop());
      if (lifecycle.isCurrent(requestGeneration)) {
        console.error('Error accessing media devices:', err);
        setState(prev => ({
          ...prev,
          error: err as Error,
          isAudioEnabled: effectiveDefaults.audioEnabled,
          isVideoEnabled: effectiveDefaults.videoEnabled,
        }));
      }
      return null;
    }
  }, [lifecycle]);

  const changeQuality = useCallback(async (quality: VideoQuality) => {
    return initializeStream(quality);
  }, [initializeStream]);

  const acquirePlaceholderReplacement = useCallback(async (
    kind: 'audio' | 'video',
    replacePlaceholderTrack?: PlaceholderTrackReplacer
  ) => {
    const stream = lifecycle.current();
    const placeholder = kind === 'audio'
      ? stream?.getAudioTracks()[0]
      : stream?.getVideoTracks()[0];
    if (!stream || !placeholder || !isPlaceholderMediaTrack(placeholder)) return false;

    let requestedStream: MediaStream | null = null;
    try {
      requestedStream = await navigator.mediaDevices.getUserMedia({
        audio: kind === 'audio',
        video: kind === 'video'
          ? {
              width: { ideal: currentQuality.width },
              height: { ideal: currentQuality.height },
              frameRate: { ideal: currentQuality.frameRate },
              facingMode: 'user',
            }
          : false,
      });

      const replacement = kind === 'audio'
        ? requestedStream.getAudioTracks()[0]
        : requestedStream.getVideoTracks()[0];
      const currentStream = lifecycle.current();
      const currentTrack = kind === 'audio'
        ? currentStream?.getAudioTracks()[0]
        : currentStream?.getVideoTracks()[0];

      if (!replacement || currentStream !== stream || currentTrack !== placeholder) {
        requestedStream.getTracks().forEach(track => track.stop());
        return false;
      }

      replacement.enabled = true;
      await replacePlaceholderTrack?.(kind, replacement, placeholder);

      const latestStream = lifecycle.current();
      const latestTrack = kind === 'audio'
        ? latestStream?.getAudioTracks()[0]
        : latestStream?.getVideoTracks()[0];
      if (latestStream !== currentStream || latestTrack !== placeholder) {
        requestedStream.getTracks().forEach(track => track.stop());
        return false;
      }

      currentStream.removeTrack(placeholder);
      placeholder.stop();
      currentStream.addTrack(replacement);
      requestedStream.getTracks().forEach(track => {
        if (track !== replacement) track.stop();
      });

      const renderedStream = new MediaStream(currentStream.getTracks());
      if (kind === 'audio') audioEnabledRef.current = true;
      if (kind === 'video') videoEnabledRef.current = true;
      setState(prev => ({
        ...prev,
        stream: renderedStream,
        error: null,
        ...(kind === 'audio' ? { isAudioEnabled: true } : { isVideoEnabled: true }),
      }));
      return true;
    } catch (err) {
      requestedStream?.getTracks().forEach(track => track.stop());
      console.error(`Error accessing ${kind} device:`, err);
      return false;
    }
  }, [currentQuality.frameRate, currentQuality.height, currentQuality.width, lifecycle]);

  const toggleAudio = useCallback(async (replacePlaceholderTrack?: PlaceholderTrackReplacer) => {
    const stream = lifecycle.current();
    const audioTrack = stream?.getAudioTracks()[0];
    if (!audioTrack) {
      const nextEnabled = !audioEnabledRef.current;
      audioEnabledRef.current = nextEnabled;
      setState(prev => ({ ...prev, isAudioEnabled: nextEnabled }));
      return nextEnabled;
    }
    if (isPlaceholderMediaTrack(audioTrack)) {
      if (pendingTrackRequestsRef.current.audio) return pendingTrackRequestsRef.current.audio;
      setState(prev => ({ ...prev, isAudioPending: true }));
      const request = acquirePlaceholderReplacement('audio', replacePlaceholderTrack);
      pendingTrackRequestsRef.current.audio = request;
      try {
        return await request;
      } finally {
        if (pendingTrackRequestsRef.current.audio === request) {
          pendingTrackRequestsRef.current.audio = null;
          setState(prev => ({ ...prev, isAudioPending: false }));
        }
      }
    }

    audioTrack.enabled = !audioTrack.enabled;
    audioEnabledRef.current = audioTrack.enabled;
    setState(prev => ({ ...prev, isAudioEnabled: audioTrack.enabled }));
    return audioTrack.enabled;
  }, [acquirePlaceholderReplacement, lifecycle]);

  const toggleVideo = useCallback(async (replacePlaceholderTrack?: PlaceholderTrackReplacer) => {
    const stream = lifecycle.current();
    const videoTrack = stream?.getVideoTracks()[0];
    if (!videoTrack) {
      const nextEnabled = !videoEnabledRef.current;
      videoEnabledRef.current = nextEnabled;
      setState(prev => ({ ...prev, isVideoEnabled: nextEnabled }));
      return nextEnabled;
    }
    if (isPlaceholderMediaTrack(videoTrack)) {
      if (pendingTrackRequestsRef.current.video) return pendingTrackRequestsRef.current.video;
      setState(prev => ({ ...prev, isVideoPending: true }));
      const request = acquirePlaceholderReplacement('video', replacePlaceholderTrack);
      pendingTrackRequestsRef.current.video = request;
      try {
        return await request;
      } finally {
        if (pendingTrackRequestsRef.current.video === request) {
          pendingTrackRequestsRef.current.video = null;
          setState(prev => ({ ...prev, isVideoPending: false }));
        }
      }
    }

    videoTrack.enabled = !videoTrack.enabled;
    videoEnabledRef.current = videoTrack.enabled;
    setState(prev => ({ ...prev, isVideoEnabled: videoTrack.enabled }));
    return videoTrack.enabled;
  }, [acquirePlaceholderReplacement, lifecycle]);

  const cleanup = useCallback(() => {
    lifecycle.cleanup();
    pendingTrackRequestsRef.current.audio = null;
    pendingTrackRequestsRef.current.video = null;
    audioEnabledRef.current = true;
    videoEnabledRef.current = true;
    setState({
      stream: null,
      error: null,
      isAudioEnabled: true,
      isVideoEnabled: true,
      isAudioPending: false,
      isVideoPending: false,
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
