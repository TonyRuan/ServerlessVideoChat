import { describe, expect, it } from 'vitest';
import {
  PREFERRED_VIDEO_CODEC_ORDER,
  preferVideoCodecsInSdp,
} from './videoCodecPreference';

const baseSdp = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 H264/90000',
  'a=rtpmap:98 VP9/90000',
  'a=rtpmap:99 AV1/90000',
  'a=rtpmap:100 H265/90000',
  'a=rtpmap:101 red/90000',
  'a=fmtp:99 profile=0',
  '',
].join('\r\n');

describe('videoCodecPreference', () => {
  it('keeps the requested video codec priority ahead of other codecs', () => {
    expect(PREFERRED_VIDEO_CODEC_ORDER).toEqual(['AV1', 'VP9', 'H265']);

    const result = preferVideoCodecsInSdp(baseSdp);

    expect(result).toContain('m=video 9 UDP/TLS/RTP/SAVPF 99 98 100 96 97 101');
    expect(result).toContain('m=audio 9 UDP/TLS/RTP/SAVPF 111 0');
  });

  it('also treats HEVC rtpmap as H265 priority', () => {
    const result = preferVideoCodecsInSdp(baseSdp.replace('a=rtpmap:100 H265/90000', 'a=rtpmap:100 HEVC/90000'));

    expect(result).toContain('m=video 9 UDP/TLS/RTP/SAVPF 99 98 100 96 97 101');
  });
});
