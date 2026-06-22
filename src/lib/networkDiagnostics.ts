export type IceCandidateType = 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown';

export interface ParsedIceCandidate {
  raw: string;
  type: IceCandidateType;
  protocol: string;
  address: string;
  port: number | null;
}

export interface IceProbeResult {
  label: string;
  candidates: ParsedIceCandidate[];
  elapsedMs: number;
  error?: string;
}

export type NoStunViability = 'lan-only' | 'not-visible';
export type TurnRecommendation = 'probably-not-needed' | 'recommended' | 'likely-needed';

export interface NetworkDiagnosticSummary {
  traversalLevel: 0 | 1 | 2 | 3;
  noStunViability: NoStunViability;
  turnRecommendation: TurnRecommendation;
  hostCandidateCount: number;
  srflxCandidateCount: number;
  relayCandidateCount: number;
  srflxEndpointCount: number;
  headline: string;
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

export const NETWORK_DIAGNOSTIC_STUN_SERVERS: { label: string; urls?: string }[] = [
  { label: '无 STUN' },
  { label: 'Cloudflare STUN', urls: 'stun:stun.cloudflare.com:3478' },
  { label: 'Google STUN', urls: 'stun:stun.l.google.com:19302' },
];

export function parseIceCandidate(raw: string): ParsedIceCandidate {
  const parts = raw.trim().split(/\s+/);
  const typIndex = parts.indexOf('typ');
  const typeValue = typIndex >= 0 ? parts[typIndex + 1] : '';
  const type: IceCandidateType =
    typeValue === 'host' || typeValue === 'srflx' || typeValue === 'relay' || typeValue === 'prflx'
      ? typeValue
      : 'unknown';

  return {
    raw,
    type,
    protocol: (parts[2] ?? '').toLowerCase(),
    address: parts[4] ?? '',
    port: Number.isFinite(Number(parts[5])) ? Number(parts[5]) : null,
  };
}

function endpointKey(candidate: ParsedIceCandidate) {
  if (!candidate.address || candidate.port === null) return '';
  return `${candidate.address}:${candidate.port}`;
}

export function summarizeNetworkDiagnostics(probes: IceProbeResult[]): NetworkDiagnosticSummary {
  const candidates = probes.flatMap((probe) => probe.candidates);
  const hostCandidateCount = candidates.filter((candidate) => candidate.type === 'host').length;
  const srflxCandidates = candidates.filter((candidate) => candidate.type === 'srflx');
  const relayCandidateCount = candidates.filter((candidate) => candidate.type === 'relay').length;
  const srflxEndpoints = new Set(srflxCandidates.map(endpointKey).filter(Boolean));
  const noStunProbe = probes.find((probe) => probe.label === '无 STUN');
  const noStunViability: NoStunViability = noStunProbe?.candidates.some((candidate) => candidate.type === 'host')
    ? 'lan-only'
    : 'not-visible';

  if (relayCandidateCount > 0) {
    return {
      traversalLevel: 3,
      noStunViability,
      turnRecommendation: 'likely-needed',
      hostCandidateCount,
      srflxCandidateCount: srflxCandidates.length,
      relayCandidateCount,
      srflxEndpointCount: srflxEndpoints.size,
      headline: '已出现 TURN 中继候选',
      detail: '这类环境通常无法稳定直连，跨网络通话应使用 TURN。浏览器已有 relay 候选时，媒体会经中继转发。',
    };
  }

  if (srflxCandidates.length === 0) {
    return {
      traversalLevel: 0,
      noStunViability,
      turnRecommendation: 'recommended',
      hostCandidateCount,
      srflxCandidateCount: 0,
      relayCandidateCount,
      srflxEndpointCount: 0,
      headline: hostCandidateCount > 0 ? '只看到本地候选' : '没有拿到可用 ICE 候选',
      detail:
        '没有拿到 STUN 公网映射。无需 STUN 通常只适合同一局域网或公网可路由主机；跨运营商/跨网络大概率需要 TURN。',
    };
  }

  if (srflxEndpoints.size > 1) {
    return {
      traversalLevel: 2,
      noStunViability,
      turnRecommendation: 'likely-needed',
      hostCandidateCount,
      srflxCandidateCount: srflxCandidates.length,
      relayCandidateCount,
      srflxEndpointCount: srflxEndpoints.size,
      headline: '公网映射不稳定',
      detail:
        '不同 STUN 探测拿到的公网地址或端口不一致，可能存在多层 NAT、端口依赖映射或对称 NAT 风险。直连不稳时需要 TURN。',
    };
  }

  return {
    traversalLevel: 1,
    noStunViability,
    turnRecommendation: 'probably-not-needed',
    hostCandidateCount,
    srflxCandidateCount: srflxCandidates.length,
    relayCandidateCount,
    srflxEndpointCount: srflxEndpoints.size,
    headline: 'STUN 可发现稳定公网映射',
    detail:
      '这台电脑当前网络看起来有较高直连概率。它仍然不是“完全不需要 STUN”；真正无需 STUN 只适合同局域网或公网直连场景。',
  };
}

export async function gatherIceCandidates(
  label: string,
  iceServers: RTCIceServer[] = [],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<IceProbeResult> {
  if (typeof RTCPeerConnection === 'undefined') {
    return {
      label,
      candidates: [],
      elapsedMs: 0,
      error: '当前浏览器不支持 RTCPeerConnection',
    };
  }

  const startedAt = performance.now();
  const candidates: ParsedIceCandidate[] = [];
  const pc = new RTCPeerConnection({ iceServers });

  try {
    pc.createDataChannel('network-diagnostic');

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const timeout = window.setTimeout(finish, timeoutMs);
      pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate) {
          window.clearTimeout(timeout);
          finish();
          return;
        }
        candidates.push(parseIceCandidate(event.candidate.candidate));
      });
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          window.clearTimeout(timeout);
          finish();
        }
      });

      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          window.clearTimeout(timeout);
          finish();
        });
    });

    return {
      label,
      candidates,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  } catch (err) {
    return {
      label,
      candidates,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    pc.close();
  }
}

export async function runNetworkDiagnostics(): Promise<{
  probes: IceProbeResult[];
  summary: NetworkDiagnosticSummary;
}> {
  const probes: IceProbeResult[] = [];

  for (const server of NETWORK_DIAGNOSTIC_STUN_SERVERS) {
    probes.push(
      await gatherIceCandidates(server.label, server.urls ? [{ urls: server.urls }] : [])
    );
  }

  return {
    probes,
    summary: summarizeNetworkDiagnostics(probes),
  };
}
