import React, { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, RefreshCw, Wifi } from 'lucide-react';
import {
  runNetworkDiagnostics,
  type IceProbeResult,
  type NetworkDiagnosticSummary,
} from '../lib/networkDiagnostics';
import type { CallConnectionStatus } from '../lib/callConnectivity';
import {
  formatConnectionBitrate,
  formatTurnUsage,
  formatVideoBitrate,
  formatVideoCodec,
  type TurnUsage,
} from '../lib/mediaStats';
import { turnFallbackStatusLabel, type TurnFallbackStatus } from '../lib/turnFallback';
import { BUILD_INFO } from '../lib/buildInfo';
import { cn } from '../lib/utils';

interface NetworkDiagnosticsPanelProps {
  effectiveConnectionStatus: CallConnectionStatus;
  rtcIceState: string;
  rtcConnectionState: string;
  remoteTrackCounts: {
    video: number;
    audio: number;
  };
  remoteVideo: {
    width: number;
    height: number;
    readyState: number;
    paused: boolean;
  };
  inbound: {
    videoBytes: number | null;
    videoBitrateKbps: number | null;
    videoCodec: string | null;
    audioBytes: number | null;
  };
  outbound: {
    videoBytes: number | null;
    videoBitrateKbps: number | null;
    videoCodec: string | null;
  };
  connection: {
    uplinkKbps: number | null;
    downlinkKbps: number | null;
    turnUsage: TurnUsage;
  };
  turnFallbackStatus: TurnFallbackStatus;
  remotePlayError: string;
}

function statusLabel(status: CallConnectionStatus) {
  const labels: Record<CallConnectionStatus, string> = {
    initializing: 'Initializing',
    waiting: 'Waiting',
    connecting: 'Connecting',
    connected: 'Connected',
    disconnected: 'Disconnected',
  };
  return labels[status];
}

function recommendationLabel(summary: NetworkDiagnosticSummary) {
  if (summary.turnRecommendation === 'probably-not-needed') return '暂未明显需要 TURN';
  if (summary.turnRecommendation === 'recommended') return '建议准备 TURN';
  return '很可能需要 TURN';
}

function noStunLabel(summary: NetworkDiagnosticSummary) {
  if (summary.noStunViability === 'lan-only') return '仅同局域网/公网主机可能';
  return '未看到可用本地候选';
}

function countTypes(probe: IceProbeResult) {
  return {
    host: probe.candidates.filter((candidate) => candidate.type === 'host').length,
    srflx: probe.candidates.filter((candidate) => candidate.type === 'srflx').length,
    relay: probe.candidates.filter((candidate) => candidate.type === 'relay').length,
  };
}

export function NetworkDiagnosticsPanel({
  effectiveConnectionStatus,
  rtcIceState,
  rtcConnectionState,
  remoteTrackCounts,
  remoteVideo,
  inbound,
  outbound,
  connection,
  turnFallbackStatus,
  remotePlayError,
}: NetworkDiagnosticsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [summary, setSummary] = useState<NetworkDiagnosticSummary | null>(null);
  const [probes, setProbes] = useState<IceProbeResult[]>([]);
  const [error, setError] = useState('');

  const run = async () => {
    setIsExpanded(true);
    setIsRunning(true);
    setError('');
    try {
      const result = await runNetworkDiagnostics();
      setSummary(result.summary);
      setProbes(result.probes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div
      className={cn(
        'absolute left-4 top-4 z-20 max-w-[calc(100vw-2rem)] border border-gray-700 bg-gray-800/85 text-xs font-medium text-gray-300 shadow-xl backdrop-blur',
        isExpanded ? 'w-[min(22rem,calc(100vw-2rem))] rounded-xl px-3 py-2' : 'w-fit rounded-full px-2.5 py-1.5'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              effectiveConnectionStatus === 'connected'
                ? 'bg-green-500'
                : effectiveConnectionStatus === 'disconnected'
                  ? 'bg-red-500'
                  : 'animate-pulse bg-yellow-500'
            )}
          />
          <span className="truncate">{statusLabel(effectiveConnectionStatus)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isExpanded && (
            <button
              type="button"
              onClick={run}
              disabled={isRunning}
              className="inline-flex items-center gap-1 rounded-md border border-gray-600 bg-gray-900/70 px-2 py-1 text-[11px] text-gray-100 transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
              title="运行 WebRTC ICE 网络环境诊断"
            >
              {isRunning ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
              网络环境诊断
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            className="rounded-md p-1 text-gray-300 transition hover:bg-gray-700"
            title={isExpanded ? '收起诊断' : '展开诊断'}
            aria-label={isExpanded ? '收起诊断' : '展开诊断'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">
            {BUILD_INFO.label}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            ICE: {rtcIceState || '-'} / PC: {rtcConnectionState || '-'}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            V: {remoteTrackCounts.video} / A: {remoteTrackCounts.audio} · Size: {remoteVideo.width}x
            {remoteVideo.height} · RS: {remoteVideo.readyState} · {remoteVideo.paused ? 'paused' : 'playing'}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            Codec: in {formatVideoCodec(inbound.videoCodec)} / out {formatVideoCodec(outbound.videoCodec)}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            Video: in {formatVideoBitrate(inbound.videoBitrateKbps)} / out{' '}
            {formatVideoBitrate(outbound.videoBitrateKbps)}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            Up: {formatConnectionBitrate(connection.uplinkKbps)} · Down:{' '}
            {formatConnectionBitrate(connection.downlinkKbps)} · TURN: {formatTurnUsage(connection.turnUsage)}
          </div>
          {turnFallbackStatus !== 'idle' && (
            <div className="mt-1 text-[11px] text-amber-300">
              TURN fallback: {turnFallbackStatusLabel(turnFallbackStatus)}
            </div>
          )}
          <div className="mt-1 text-[11px] text-gray-400">
            Bytes: inV {inbound.videoBytes ?? '-'} / outV {outbound.videoBytes ?? '-'} / inA{' '}
            {inbound.audioBytes ?? '-'}
          </div>
          {remotePlayError && <div className="mt-1 text-[11px] text-amber-400">Play: {remotePlayError}</div>}

          <div className="mt-3 border-t border-gray-700 pt-3">
          {!summary && !error && (
            <div className="flex items-center gap-2 text-[11px] text-gray-400">
              <Wifi className="h-3.5 w-3.5" />
              点击“网络环境诊断”采集 ICE 候选。
            </div>
          )}

          {error && <div className="text-[11px] text-red-300">诊断失败：{error}</div>}

          {summary && (
            <div className="space-y-2">
              <div className="rounded-lg border border-gray-700 bg-gray-900/65 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-100">{summary.headline}</span>
                  <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-100">
                    估算 L{summary.traversalLevel}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-gray-400">{summary.detail}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-md bg-gray-900/60 p-2">
                  <div className="text-gray-500">无需 STUN</div>
                  <div className="mt-1 text-gray-100">{noStunLabel(summary)}</div>
                </div>
                <div className="rounded-md bg-gray-900/60 p-2">
                  <div className="text-gray-500">TURN 判断</div>
                  <div className="mt-1 text-gray-100">{recommendationLabel(summary)}</div>
                </div>
              </div>

              <div className="rounded-md bg-gray-900/60 p-2 text-[11px] text-gray-400">
                <div>
                  候选统计：host {summary.hostCandidateCount} / srflx {summary.srflxCandidateCount} / relay{' '}
                  {summary.relayCandidateCount}
                </div>
                <div className="mt-1">公网映射端点数：{summary.srflxEndpointCount}</div>
                <div className="mt-1 text-gray-500">真实 NAT 层数浏览器无法精确读取，这里按 ICE 可达性估算。</div>
              </div>

              <div className="space-y-1 text-[11px] text-gray-400">
                {probes.map((probe) => {
                  const counts = countTypes(probe);
                  return (
                    <div key={probe.label} className="flex justify-between gap-2 rounded bg-gray-900/40 px-2 py-1">
                      <span>{probe.label}</span>
                      <span>
                        h {counts.host} / s {counts.srflx} / r {counts.relay} · {probe.elapsedMs}ms
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
