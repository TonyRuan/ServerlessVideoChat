import type { CallMediaDefaults } from './callSession';

export interface MediaVideoQuality {
  width: number;
  height: number;
  frameRate: number;
}

const placeholderTracks = new WeakSet<MediaStreamTrack>();

export function buildMediaStreamConstraints(
  quality: MediaVideoQuality,
  defaults: CallMediaDefaults
): MediaStreamConstraints | null {
  if (!defaults.audioEnabled && !defaults.videoEnabled) return null;

  return {
    audio: defaults.audioEnabled,
    video: defaults.videoEnabled
      ? {
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.frameRate },
          facingMode: 'user',
        }
      : false,
  };
}

function markPlaceholder(track: MediaStreamTrack) {
  track.enabled = false;
  placeholderTracks.add(track);
  return track;
}

export function isPlaceholderMediaTrack(track: MediaStreamTrack | undefined) {
  return Boolean(track && placeholderTracks.has(track));
}

export function createBlackVideoPlaceholderTrack() {
  if (typeof document === 'undefined') {
    throw new Error('当前环境无法创建视频占位轨道');
  }

  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext('2d');
  context?.fillRect(0, 0, canvas.width, canvas.height);

  if (typeof canvas.captureStream !== 'function') {
    throw new Error('当前浏览器不支持无摄像头视频会话');
  }

  const track = canvas.captureStream(1).getVideoTracks()[0];
  if (!track) throw new Error('无法创建视频占位轨道');
  return markPlaceholder(track);
}

export function createSilentAudioPlaceholderTrack() {
  if (typeof window === 'undefined') {
    throw new Error('当前环境无法创建音频占位轨道');
  }

  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('当前浏览器不支持无麦克风音频会话');
  }

  const audioContext = new AudioContextConstructor();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const destination = audioContext.createMediaStreamDestination();
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();

  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    oscillator.stop();
    void audioContext.close();
    throw new Error('无法创建音频占位轨道');
  }

  const stopTrack = track.stop.bind(track);
  let stopped = false;
  track.stop = () => {
    if (stopped) return;
    stopped = true;
    stopTrack();
    oscillator.stop();
    void audioContext.close();
  };

  return markPlaceholder(track);
}

export function addDisabledPlaceholderTracks(stream: MediaStream, defaults: CallMediaDefaults) {
  if (!defaults.audioEnabled) stream.addTrack(createSilentAudioPlaceholderTrack());
  if (!defaults.videoEnabled) stream.addTrack(createBlackVideoPlaceholderTrack());
  return stream;
}

export async function replaceNegotiatedMediaTrack(
  peerConnection: RTCPeerConnection,
  kind: 'audio' | 'video',
  replacement: MediaStreamTrack,
  placeholder: MediaStreamTrack
) {
  const senders = peerConnection.getSenders();
  const sender = senders.find(candidate => candidate.track === placeholder)
    ?? senders.find(candidate => candidate.track?.kind === kind);
  if (!sender) {
    throw new Error(`找不到已协商的${kind === 'audio' ? '音频' : '视频'}发送通道`);
  }

  await sender.replaceTrack(replacement);
}
