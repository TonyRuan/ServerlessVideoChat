import { describe, expect, it } from 'vitest';
import {
  parseIceCandidate,
  summarizeNetworkDiagnostics,
  type IceProbeResult,
} from './networkDiagnostics';

function probe(label: string, candidates: string[], error?: string): IceProbeResult {
  return {
    label,
    candidates: candidates.map((candidate) => parseIceCandidate(candidate)),
    elapsedMs: 120,
    error,
  };
}

describe('networkDiagnostics', () => {
  it('parses ICE candidate type, protocol, address, and port', () => {
    expect(
      parseIceCandidate(
        'candidate:842163049 1 udp 1677729535 192.168.1.12 53182 typ srflx raddr 0.0.0.0 rport 9'
      )
    ).toMatchObject({
      type: 'srflx',
      protocol: 'udp',
      address: '192.168.1.12',
      port: 53182,
    });
  });

  it('marks host-only candidates as LAN-only without STUN', () => {
    const summary = summarizeNetworkDiagnostics([
      probe('无 STUN', ['candidate:1 1 udp 2122260223 host-123.local 54622 typ host']),
      probe('Cloudflare STUN', []),
    ]);

    expect(summary.traversalLevel).toBe(0);
    expect(summary.noStunViability).toBe('lan-only');
    expect(summary.turnRecommendation).toBe('recommended');
  });

  it('treats a stable server-reflexive endpoint as likely STUN-direct capable', () => {
    const summary = summarizeNetworkDiagnostics([
      probe('无 STUN', ['candidate:1 1 udp 2122260223 host-123.local 54622 typ host']),
      probe('Cloudflare STUN', ['candidate:2 1 udp 1677729535 203.0.113.10 40000 typ srflx']),
      probe('Google STUN', ['candidate:3 1 udp 1677729535 203.0.113.10 40000 typ srflx']),
    ]);

    expect(summary.traversalLevel).toBe(1);
    expect(summary.noStunViability).toBe('lan-only');
    expect(summary.turnRecommendation).toBe('probably-not-needed');
  });

  it('flags changing server-reflexive endpoints as a higher traversal risk', () => {
    const summary = summarizeNetworkDiagnostics([
      probe('Cloudflare STUN', ['candidate:2 1 udp 1677729535 203.0.113.10 40000 typ srflx']),
      probe('Google STUN', ['candidate:3 1 udp 1677729535 203.0.113.10 49152 typ srflx']),
    ]);

    expect(summary.traversalLevel).toBe(2);
    expect(summary.turnRecommendation).toBe('likely-needed');
  });
});
