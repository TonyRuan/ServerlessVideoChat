import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMediaStreamConstraints,
  createBlackVideoPlaceholderTrack,
  createSilentAudioPlaceholderTrack,
  isPlaceholderMediaTrack,
  replaceNegotiatedMediaTrack,
} from './mediaDevicePolicy';

afterEach(() => {
  vi.unstubAllGlobals();
});

const quality = {
  width: 1280,
  height: 720,
  frameRate: 30,
};

describe('buildMediaStreamConstraints', () => {
  it('requests both devices for a regular video session', () => {
    expect(buildMediaStreamConstraints(quality, {
      audioEnabled: true,
      videoEnabled: true,
    })).toEqual({
      audio: true,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      },
    });
  });

  it('does not request the camera for a voice-only session', () => {
    expect(buildMediaStreamConstraints(quality, {
      audioEnabled: true,
      videoEnabled: false,
    })).toEqual({
      audio: true,
      video: false,
    });
  });

  it('does not request the microphone for a video-only session', () => {
    expect(buildMediaStreamConstraints(quality, {
      audioEnabled: false,
      videoEnabled: true,
    })).toEqual({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      },
    });
  });

  it('skips getUserMedia entirely for a text-only session', () => {
    expect(buildMediaStreamConstraints(quality, {
      audioEnabled: false,
      videoEnabled: false,
    })).toBeNull();
  });
});

describe('replaceNegotiatedMediaTrack', () => {
  const track = (kind: 'audio' | 'video') => ({ kind }) as MediaStreamTrack;

  it('awaits replacement on the sender that owns the placeholder', async () => {
    const placeholder = track('video');
    const replacement = track('video');
    const replaceTrack = vi.fn().mockResolvedValue(undefined);
    const peerConnection = {
      getSenders: () => [{ track: placeholder, replaceTrack }],
    } as unknown as RTCPeerConnection;

    await replaceNegotiatedMediaTrack(peerConnection, 'video', replacement, placeholder);

    expect(replaceTrack).toHaveBeenCalledWith(replacement);
  });

  it('rejects when no negotiated sender exists', async () => {
    const placeholder = track('audio');
    const peerConnection = {
      getSenders: () => [],
    } as unknown as RTCPeerConnection;

    await expect(replaceNegotiatedMediaTrack(
      peerConnection,
      'audio',
      track('audio'),
      placeholder
    )).rejects.toThrow('找不到已协商的音频发送通道');
  });

  it('propagates replaceTrack failures so the caller can keep the placeholder', async () => {
    const placeholder = track('video');
    const replaceTrack = vi.fn().mockRejectedValue(new Error('incompatible track'));
    const peerConnection = {
      getSenders: () => [{ track: placeholder, replaceTrack }],
    } as unknown as RTCPeerConnection;

    await expect(replaceNegotiatedMediaTrack(
      peerConnection,
      'video',
      track('video'),
      placeholder
    )).rejects.toThrow('incompatible track');
  });
});

describe('placeholder tracks', () => {
  it('creates a disabled black video track without accessing a camera', () => {
    const placeholder = { enabled: true } as MediaStreamTrack;
    const fillRect = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillRect }),
        captureStream: () => ({ getVideoTracks: () => [placeholder] }),
      }),
    });

    const track = createBlackVideoPlaceholderTrack();

    expect(track.enabled).toBe(false);
    expect(isPlaceholderMediaTrack(track)).toBe(true);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2, 2);
  });

  it('stops and closes silent-audio resources exactly once', () => {
    const nativeStop = vi.fn();
    const oscillatorStop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const placeholder = { enabled: true, stop: nativeStop } as unknown as MediaStreamTrack;
    class FakeAudioContext {
      createOscillator() {
        return { connect: vi.fn(), start: vi.fn(), stop: oscillatorStop };
      }
      createGain() {
        return { connect: vi.fn(), gain: { value: 1 } };
      }
      createMediaStreamDestination() {
        return { stream: { getAudioTracks: () => [placeholder] } };
      }
      close = close;
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });

    const track = createSilentAudioPlaceholderTrack();
    track.stop();
    track.stop();

    expect(track.enabled).toBe(false);
    expect(isPlaceholderMediaTrack(track)).toBe(true);
    expect(nativeStop).toHaveBeenCalledTimes(1);
    expect(oscillatorStop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
