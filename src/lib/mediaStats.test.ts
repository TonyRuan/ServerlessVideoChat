import { describe, expect, it } from 'vitest';
import {
  extractConnectionTransferStats,
  extractOutboundVideoTransferStats,
  extractInboundVideoTransferStats,
  formatConnectionBitrate,
  formatTurnUsage,
  formatVideoBitrate,
  formatVideoCodec,
} from './mediaStats';

function statsReport(reports: Array<Record<string, unknown>>) {
  return {
    forEach(callback: (report: Record<string, unknown>, id: string) => void) {
      reports.forEach((report, index) => callback(report, String(report.id ?? index)));
    },
  };
}

describe('mediaStats', () => {
  it('extracts inbound video codec and bitrate from RTC stats', () => {
    const previous = { bytesReceived: 120_000, timestamp: 1_000 };
    const result = extractInboundVideoTransferStats(
      statsReport([
        { id: 'codec-1', type: 'codec', mimeType: 'video/VP9' },
        {
          id: 'inbound-video',
          type: 'inbound-rtp',
          kind: 'video',
          bytesReceived: 320_000,
          timestamp: 2_000,
          codecId: 'codec-1',
        },
      ]),
      previous
    );

    expect(result.metrics.codec).toBe('VP9');
    expect(result.metrics.bytesReceived).toBe(320_000);
    expect(result.metrics.bitrateKbps).toBe(1600);
    expect(result.sample).toEqual({ bytesReceived: 320_000, timestamp: 2_000 });
  });

  it('falls back to codec data attached to the inbound RTP report', () => {
    const result = extractInboundVideoTransferStats(
      statsReport([
        {
          id: 'inbound-video',
          type: 'inbound-rtp',
          mediaType: 'video',
          bytesReceived: 50_000,
          timestamp: 2_000,
          mimeType: 'video/H264',
        },
      ]),
      null
    );

    expect(result.metrics.codec).toBe('H264');
    expect(result.metrics.bitrateKbps).toBeNull();
  });

  it('extracts outbound video codec and bitrate from RTC stats', () => {
    const previous = { bytesSent: 20_000, timestamp: 1_000 };
    const result = extractOutboundVideoTransferStats(
      statsReport([
        { id: 'codec-1', type: 'codec', mimeType: 'video/AV1' },
        {
          id: 'outbound-video',
          type: 'outbound-rtp',
          kind: 'video',
          bytesSent: 95_000,
          timestamp: 2_000,
          codecId: 'codec-1',
        },
      ]),
      previous
    );

    expect(result.metrics.codec).toBe('AV1');
    expect(result.metrics.bytesSent).toBe(95_000);
    expect(result.metrics.bitrateKbps).toBe(600);
    expect(result.sample).toEqual({ bytesSent: 95_000, timestamp: 2_000 });
  });

  it('formats missing and available video transfer values for the compact panel', () => {
    expect(formatVideoCodec(null)).toBe('-');
    expect(formatVideoCodec('video/AV1')).toBe('AV1');
    expect(formatVideoBitrate(null)).toBe('-');
    expect(formatVideoBitrate(832)).toBe('832 kbps');
    expect(formatVideoBitrate(1600)).toBe('1.6 Mbps');
  });

  it('extracts aggregate uplink and downlink bitrate from RTP stats', () => {
    const previous = { bytesSent: 10_000, bytesReceived: 20_000, timestamp: 1_000 };
    const result = extractConnectionTransferStats(
      statsReport([
        { id: 'outbound-video', type: 'outbound-rtp', kind: 'video', bytesSent: 210_000, timestamp: 2_000 },
        { id: 'outbound-audio', type: 'outbound-rtp', kind: 'audio', bytesSent: 20_000, timestamp: 2_000 },
        { id: 'inbound-video', type: 'inbound-rtp', kind: 'video', bytesReceived: 320_000, timestamp: 2_000 },
        { id: 'inbound-audio', type: 'inbound-rtp', kind: 'audio', bytesReceived: 40_000, timestamp: 2_000 },
      ]),
      previous
    );

    expect(result.metrics.bytesSent).toBe(230_000);
    expect(result.metrics.bytesReceived).toBe(360_000);
    expect(result.metrics.uplinkKbps).toBe(1760);
    expect(result.metrics.downlinkKbps).toBe(2720);
    expect(result.sample).toEqual({ bytesSent: 230_000, bytesReceived: 360_000, timestamp: 2_000 });
  });

  it('prefers selected candidate pair byte counters for connection bandwidth', () => {
    const previous = { bytesSent: 100_000, bytesReceived: 200_000, timestamp: 1_000 };
    const result = extractConnectionTransferStats(
      statsReport([
        { id: 'transport-1', type: 'transport', selectedCandidatePairId: 'pair-1' },
        {
          id: 'pair-1',
          type: 'candidate-pair',
          state: 'succeeded',
          bytesSent: 400_000,
          bytesReceived: 700_000,
          timestamp: 2_000,
          localCandidateId: 'local-1',
          remoteCandidateId: 'remote-1',
        },
        { id: 'local-1', type: 'local-candidate', candidateType: 'host' },
        { id: 'remote-1', type: 'remote-candidate', candidateType: 'srflx' },
        { id: 'outbound-video', type: 'outbound-rtp', kind: 'video', bytesSent: 10_000, timestamp: 2_000 },
        { id: 'inbound-video', type: 'inbound-rtp', kind: 'video', bytesReceived: 20_000, timestamp: 2_000 },
      ]),
      previous
    );

    expect(result.metrics.bytesSent).toBe(400_000);
    expect(result.metrics.bytesReceived).toBe(700_000);
    expect(result.metrics.uplinkKbps).toBe(2400);
    expect(result.metrics.downlinkKbps).toBe(4000);
    expect(result.metrics.turnUsage.isUsingTurn).toBe(false);
  });

  it('detects TURN usage from the selected candidate pair', () => {
    const result = extractConnectionTransferStats(
      statsReport([
        { id: 'transport-1', type: 'transport', selectedCandidatePairId: 'pair-1' },
        {
          id: 'pair-1',
          type: 'candidate-pair',
          state: 'succeeded',
          localCandidateId: 'local-1',
          remoteCandidateId: 'remote-1',
        },
        { id: 'local-1', type: 'local-candidate', candidateType: 'relay' },
        { id: 'remote-1', type: 'remote-candidate', candidateType: 'srflx' },
      ]),
      null
    );

    expect(result.metrics.turnUsage).toEqual({
      isUsingTurn: true,
      localCandidateType: 'relay',
      remoteCandidateType: 'srflx',
    });
    expect(formatTurnUsage(result.metrics.turnUsage)).toBe('使用中');
  });

  it('does not report TURN usage for unselected relay candidates', () => {
    const result = extractConnectionTransferStats(
      statsReport([
        { id: 'transport-1', type: 'transport', selectedCandidatePairId: 'pair-direct' },
        {
          id: 'pair-direct',
          type: 'candidate-pair',
          state: 'succeeded',
          localCandidateId: 'local-host',
          remoteCandidateId: 'remote-srflx',
        },
        {
          id: 'pair-relay',
          type: 'candidate-pair',
          state: 'succeeded',
          localCandidateId: 'local-relay',
          remoteCandidateId: 'remote-srflx',
        },
        { id: 'local-host', type: 'local-candidate', candidateType: 'host' },
        { id: 'local-relay', type: 'local-candidate', candidateType: 'relay' },
        { id: 'remote-srflx', type: 'remote-candidate', candidateType: 'srflx' },
      ]),
      null
    );

    expect(result.metrics.turnUsage).toEqual({
      isUsingTurn: false,
      localCandidateType: 'host',
      remoteCandidateType: 'srflx',
    });
    expect(formatTurnUsage(result.metrics.turnUsage)).toBe('未选中');
  });

  it('formats missing and available connection transfer values for the compact panel', () => {
    expect(formatConnectionBitrate(null)).toBe('-');
    expect(formatConnectionBitrate(42)).toBe('42 kbps');
    expect(formatConnectionBitrate(2530)).toBe('2.5 Mbps');
    expect(formatTurnUsage({ isUsingTurn: false, localCandidateType: 'host', remoteCandidateType: 'srflx' })).toBe(
      '未选中'
    );
    expect(formatTurnUsage({ isUsingTurn: null, localCandidateType: null, remoteCandidateType: null })).toBe('-');
  });
});
