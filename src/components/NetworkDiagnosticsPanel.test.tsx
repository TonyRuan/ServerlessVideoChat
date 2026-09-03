import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NetworkDiagnosticsPanel, TransportDiagnosticsDetails } from './NetworkDiagnosticsPanel';

function renderPanel({
  peerStatus = 'ready',
  peerIssueType,
}: {
  peerStatus?: 'ready' | 'reconnecting';
  peerIssueType?: string;
} = {}) {
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
      controlTransport={{
        iceState: 'connected',
        connectionState: 'connected',
        turnUsage: { isUsingTurn: false, localCandidateType: 'host', remoteCandidateType: 'srflx' },
      }}
      bulkTransport={{
        iceState: 'connected',
        connectionState: 'connected',
        turnUsage: { isUsingTurn: true, localCandidateType: 'relay', remoteCandidateType: 'srflx' },
      }}
      credentialSource="dynamic"
      credentialExpiresAt={1_800_000_000_000}
      turnFallbackStatus="idle"
      remotePlayError=""
      peerStatus={peerStatus}
      peerIssueType={peerIssueType}
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

  it('renders separate media, control, and bulk transport details without exposing credentials', () => {
    const markup = renderToStaticMarkup(
      <TransportDiagnosticsDetails
        media={{
          iceState: 'connected',
          connectionState: 'connected',
          turnUsage: { isUsingTurn: false, localCandidateType: 'host', remoteCandidateType: 'srflx' },
        }}
        control={{
          iceState: 'connected',
          connectionState: 'connected',
          turnUsage: { isUsingTurn: true, localCandidateType: 'relay', remoteCandidateType: 'srflx' },
        }}
        bulk={{
          iceState: 'checking',
          connectionState: 'connecting',
          turnUsage: { isUsingTurn: null, localCandidateType: null, remoteCandidateType: null },
        }}
        credentialSource="dynamic"
        credentialExpiresAt={1_800_000_000_000}
      />
    );

    expect(markup).toContain('媒体');
    expect(markup).toContain('聊天控制');
    expect(markup).toContain('文件通道');
    expect(markup).toContain('动态短期凭据');
    expect(markup).not.toContain('temporary-credential');
    expect(markup).not.toContain('turn.example.com');
  });

  it('shows signaling degradation even while an existing media transport remains connected', () => {
    const markup = renderPanel({ peerStatus: 'reconnecting', peerIssueType: 'network' });

    expect(markup).toContain('Signaling reconnecting');
    expect(markup).not.toContain('>Connected<');
  });
});
