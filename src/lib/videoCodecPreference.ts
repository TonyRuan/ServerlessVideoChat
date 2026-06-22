export const PREFERRED_VIDEO_CODEC_ORDER = ['AV1', 'VP9', 'H265'] as const;

const H265_ALIASES = new Set(['H265', 'HEVC']);

function normalizeCodecName(codec: string): string {
  const upper = codec.trim().toUpperCase();
  return H265_ALIASES.has(upper) ? 'H265' : upper;
}

function lineBreakForSdp(sdp: string): string {
  return sdp.includes('\r\n') ? '\r\n' : '\n';
}

function splitPayloads(line: string): {
  prefix: string;
  payloads: string[];
} | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4 || !parts[0].startsWith('m=')) return null;

  return {
    prefix: parts.slice(0, 3).join(' '),
    payloads: parts.slice(3),
  };
}

function getVideoRtpPayloadCodecs(lines: string[], videoStartIndex: number): Map<string, string> {
  const codecByPayload = new Map<string, string>();

  for (let index = videoStartIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('m=')) break;

    const match = line.match(/^a=rtpmap:(\S+)\s+([^/\s]+)/i);
    if (!match) continue;

    codecByPayload.set(match[1], normalizeCodecName(match[2]));
  }

  return codecByPayload;
}

function payloadPriority(payload: string, codecByPayload: Map<string, string>): number {
  const codec = codecByPayload.get(payload);
  if (!codec) return PREFERRED_VIDEO_CODEC_ORDER.length;

  const index = PREFERRED_VIDEO_CODEC_ORDER.findIndex((preferred) => preferred === codec);
  return index === -1 ? PREFERRED_VIDEO_CODEC_ORDER.length : index;
}

export function preferVideoCodecsInSdp(sdp: string): string {
  const newline = lineBreakForSdp(sdp);
  const lines = sdp.split(newline);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('m=video ')) continue;

    const videoLine = splitPayloads(lines[index]);
    if (!videoLine) continue;

    const codecByPayload = getVideoRtpPayloadCodecs(lines, index);
    const orderedPayloads = [...videoLine.payloads].sort((left, right) => {
      const priorityDelta = payloadPriority(left, codecByPayload) - payloadPriority(right, codecByPayload);
      if (priorityDelta !== 0) return priorityDelta;
      return videoLine.payloads.indexOf(left) - videoLine.payloads.indexOf(right);
    });

    lines[index] = `${videoLine.prefix} ${orderedPayloads.join(' ')}`;
  }

  return lines.join(newline);
}
