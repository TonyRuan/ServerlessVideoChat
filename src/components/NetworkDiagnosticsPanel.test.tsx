import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NetworkDiagnosticsPanel } from './NetworkDiagnosticsPanel';

function renderPanel() {
  return renderToStaticMarkup(
    <NetworkDiagnosticsPanel
      effectiveConnectionStatus="connected"
      rtcIceState="connected"
      rtcConnectionState="connected"
      remoteTrackCounts={{ video: 1, audio: 1 }}
      remoteVideo={{ width: 1280, height: 720, readyState: 4, paused: false }}
      inbound={{
        videoBytes: 1234,
        videoBitrateKbps: 512,
        videoCodec: 'vp9',
        audioBytes: 4321,
      }}
      outbound={{
        videoBytes: 5678,
        videoBitrateKbps: 384,
        videoCodec: 'vp8',
      }}
      connection={{
        uplinkKbps: 420,
        downlinkKbps: 620,
        turnUsage: { isUsingTurn: true, localCandidateType: 'relay', remoteCandidateType: 'srflx' },
      }}
      turnFallbackStatus="idle"
      remotePlayError=""
    />
  );
}

describe('NetworkDiagnosticsPanel', () => {
  it('keeps the collapsed state limited to the connection status', () => {
    const markup = renderPanel();

    expect(markup).toContain('Connected');
    expect(markup).not.toContain('ICE:');
    expect(markup).not.toContain('Codec:');
    expect(markup).not.toContain('Bytes:');
    expect(markup).not.toContain('网络环境诊断');
  });
});
