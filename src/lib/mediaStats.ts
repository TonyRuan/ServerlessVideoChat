export interface VideoTransferSample {
  bytesReceived: number;
  timestamp: number;
}

export interface OutboundVideoTransferSample {
  bytesSent: number;
  timestamp: number;
}

export interface VideoTransferMetrics {
  bytesReceived: number | null;
  bitrateKbps: number | null;
  codec: string | null;
}

export interface OutboundVideoTransferMetrics {
  bytesSent: number | null;
  bitrateKbps: number | null;
  codec: string | null;
}

export interface ConnectionTransferSample {
  bytesSent: number;
  bytesReceived: number;
  timestamp: number;
}

export interface TurnUsage {
  isUsingTurn: boolean | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
}

export interface ConnectionTransferMetrics {
  bytesSent: number | null;
  bytesReceived: number | null;
  uplinkKbps: number | null;
  downlinkKbps: number | null;
  turnUsage: TurnUsage;
}

interface StatsReportLike {
  forEach(callback: (report: unknown, id: string) => void): void;
}

type StatsRecord = Record<string, unknown>;

function isRecord(value: unknown): value is StatsRecord {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeCodec(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const codec = trimmed.includes('/') ? trimmed.split('/').pop() : trimmed;
  return codec ? codec.toUpperCase() : null;
}

function normalizeCandidateType(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function calculateBitrateKbps(
  sample: VideoTransferSample | null,
  previous: VideoTransferSample | null | undefined
): number | null {
  if (!sample || !previous) return null;
  const deltaBytes = sample.bytesReceived - previous.bytesReceived;
  const deltaMs = sample.timestamp - previous.timestamp;
  if (deltaBytes < 0 || deltaMs <= 0) return null;
  return Math.round(deltaBytes * 8 / deltaMs * 10) / 10;
}

function calculateByteDeltaKbps(current: number, previous: number, deltaMs: number): number | null {
  const deltaBytes = current - previous;
  if (deltaBytes < 0 || deltaMs <= 0) return null;
  return Math.round(deltaBytes * 8 / deltaMs * 10) / 10;
}

function collectReports(stats: StatsReportLike): StatsRecord[] {
  const reports: StatsRecord[] = [];
  stats.forEach((report, id) => {
    if (isRecord(report)) {
      reports.push({ id, ...report });
    }
  });
  return reports;
}

function isRtpMediaReport(report: StatsRecord): boolean {
  const kind = report.kind ?? report.mediaType;
  return kind === 'audio' || kind === 'video';
}

function selectedCandidatePair(reports: StatsRecord[], reportById: Map<string, StatsRecord>): StatsRecord | null {
  for (const report of reports) {
    if (report.type !== 'transport') continue;
    const pairId = typeof report.selectedCandidatePairId === 'string' ? report.selectedCandidatePairId : null;
    if (!pairId) continue;
    return reportById.get(pairId) ?? null;
  }

  return reports.find((report) => report.type === 'candidate-pair' && report.selected === true) ??
    reports.find((report) => report.type === 'candidate-pair' && report.nominated === true && report.state === 'succeeded') ??
    null;
}

function candidateTypeForId(reportById: Map<string, StatsRecord>, id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const candidate = reportById.get(id);
  return normalizeCandidateType(candidate?.candidateType);
}

function extractTurnUsage(reports: StatsRecord[]): TurnUsage {
  const reportById = new Map<string, StatsRecord>();
  for (const report of reports) {
    const id = typeof report.id === 'string' ? report.id : null;
    if (id) {
      reportById.set(id, report);
    }
  }

  const pair = selectedCandidatePair(reports, reportById);
  if (!pair) {
    return { isUsingTurn: null, localCandidateType: null, remoteCandidateType: null };
  }

  const localCandidateType = normalizeCandidateType(pair.localCandidateType) ??
    candidateTypeForId(reportById, pair.localCandidateId);
  const remoteCandidateType = normalizeCandidateType(pair.remoteCandidateType) ??
    candidateTypeForId(reportById, pair.remoteCandidateId);

  const knownTypes = [localCandidateType, remoteCandidateType].filter(Boolean);
  return {
    isUsingTurn: knownTypes.length > 0 ? knownTypes.includes('relay') : null,
    localCandidateType,
    remoteCandidateType,
  };
}

function selectedPairTransferSample(pair: StatsRecord | null): ConnectionTransferSample | null {
  if (!pair) return null;

  const bytesSent = asNumber(pair.bytesSent);
  const bytesReceived = asNumber(pair.bytesReceived);
  const timestamp = asNumber(pair.timestamp);
  if (bytesSent === null || bytesReceived === null || timestamp === null) return null;

  return { bytesSent, bytesReceived, timestamp };
}

function codecMapFromReports(reports: StatsRecord[]): Map<string, string> {
  const codecById = new Map<string, string>();
  for (const report of reports) {
    if (report.type !== 'codec') continue;
    const id = typeof report.id === 'string' ? report.id : null;
    const codec = normalizeCodec(report.mimeType ?? report.codec);
    if (id && codec) {
      codecById.set(id, codec);
    }
  }
  return codecById;
}

export function extractInboundVideoTransferStats(
  stats: StatsReportLike,
  previous: VideoTransferSample | null | undefined
): { metrics: VideoTransferMetrics; sample: VideoTransferSample | null } {
  const reports = collectReports(stats);
  const codecById = codecMapFromReports(reports);

  let bytesReceived = 0;
  let timestamp = 0;
  let hasVideo = false;
  let codec: string | null = null;

  for (const report of reports) {
    if (report.type !== 'inbound-rtp') continue;
    const kind = report.kind ?? report.mediaType;
    if (kind !== 'video') continue;

    const reportBytes = asNumber(report.bytesReceived);
    const reportTimestamp = asNumber(report.timestamp);
    if (reportBytes === null || reportTimestamp === null) continue;

    hasVideo = true;
    bytesReceived += reportBytes;
    timestamp = Math.max(timestamp, reportTimestamp);

    const codecId = typeof report.codecId === 'string' ? report.codecId : null;
    codec = codec ?? (codecId ? codecById.get(codecId) ?? null : null) ?? normalizeCodec(report.mimeType ?? report.codec);
  }

  const sample = hasVideo ? { bytesReceived, timestamp } : null;

  return {
    sample,
    metrics: {
      bytesReceived: hasVideo ? bytesReceived : null,
      bitrateKbps: calculateBitrateKbps(sample, previous),
      codec,
    },
  };
}

export function extractOutboundVideoTransferStats(
  stats: StatsReportLike,
  previous: OutboundVideoTransferSample | null | undefined
): { metrics: OutboundVideoTransferMetrics; sample: OutboundVideoTransferSample | null } {
  const reports = collectReports(stats);
  const codecById = codecMapFromReports(reports);
  let bytesSent = 0;
  let timestamp = 0;
  let hasVideo = false;
  let codec: string | null = null;

  for (const report of reports) {
    if (report.type !== 'outbound-rtp') continue;
    const kind = report.kind ?? report.mediaType;
    if (kind !== 'video') continue;

    const reportBytes = asNumber(report.bytesSent);
    const reportTimestamp = asNumber(report.timestamp);
    if (reportBytes === null || reportTimestamp === null) continue;

    hasVideo = true;
    bytesSent += reportBytes;
    timestamp = Math.max(timestamp, reportTimestamp);

    const codecId = typeof report.codecId === 'string' ? report.codecId : null;
    codec = codec ?? (codecId ? codecById.get(codecId) ?? null : null) ?? normalizeCodec(report.mimeType ?? report.codec);
  }

  const sample = hasVideo ? { bytesSent, timestamp } : null;
  const deltaMs = sample && previous ? sample.timestamp - previous.timestamp : 0;

  return {
    sample,
    metrics: {
      bytesSent: hasVideo ? bytesSent : null,
      bitrateKbps: sample && previous ? calculateByteDeltaKbps(sample.bytesSent, previous.bytesSent, deltaMs) : null,
      codec,
    },
  };
}

export function extractConnectionTransferStats(
  stats: StatsReportLike,
  previous: ConnectionTransferSample | null | undefined
): { metrics: ConnectionTransferMetrics; sample: ConnectionTransferSample | null } {
  const reports = collectReports(stats);
  const reportById = new Map<string, StatsRecord>();
  for (const report of reports) {
    const id = typeof report.id === 'string' ? report.id : null;
    if (id) {
      reportById.set(id, report);
    }
  }

  const pairSample = selectedPairTransferSample(selectedCandidatePair(reports, reportById));
  let bytesSent = 0;
  let bytesReceived = 0;
  let timestamp = 0;
  let hasRtp = false;

  for (const report of reports) {
    if (!isRtpMediaReport(report)) continue;

    if (report.type === 'outbound-rtp') {
      const reportBytes = asNumber(report.bytesSent);
      const reportTimestamp = asNumber(report.timestamp);
      if (reportBytes === null || reportTimestamp === null) continue;
      hasRtp = true;
      bytesSent += reportBytes;
      timestamp = Math.max(timestamp, reportTimestamp);
    } else if (report.type === 'inbound-rtp') {
      const reportBytes = asNumber(report.bytesReceived);
      const reportTimestamp = asNumber(report.timestamp);
      if (reportBytes === null || reportTimestamp === null) continue;
      hasRtp = true;
      bytesReceived += reportBytes;
      timestamp = Math.max(timestamp, reportTimestamp);
    }
  }

  const sample = pairSample ?? (hasRtp ? { bytesSent, bytesReceived, timestamp } : null);
  const deltaMs = sample && previous ? sample.timestamp - previous.timestamp : 0;

  return {
    sample,
    metrics: {
      bytesSent: sample ? sample.bytesSent : null,
      bytesReceived: sample ? sample.bytesReceived : null,
      uplinkKbps: sample && previous ? calculateByteDeltaKbps(sample.bytesSent, previous.bytesSent, deltaMs) : null,
      downlinkKbps: sample && previous ? calculateByteDeltaKbps(sample.bytesReceived, previous.bytesReceived, deltaMs) : null,
      turnUsage: extractTurnUsage(reports),
    },
  };
}

export function formatVideoCodec(codec: string | null): string {
  return normalizeCodec(codec) ?? '-';
}

export function formatConnectionBitrate(kbps: number | null): string {
  if (kbps === null || !Number.isFinite(kbps)) return '-';
  if (kbps >= 1000) {
    const mbps = Math.round(kbps / 100) / 10;
    return `${Number.isInteger(mbps) ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`;
  }
  return `${Math.round(kbps)} kbps`;
}

export function formatVideoBitrate(kbps: number | null): string {
  return formatConnectionBitrate(kbps);
}

export function formatTurnUsage(turnUsage: TurnUsage): string {
  if (turnUsage.isUsingTurn === null) return '-';
  return turnUsage.isUsingTurn ? '使用中' : '未选中';
}
