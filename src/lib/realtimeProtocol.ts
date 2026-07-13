export interface QualityChangePayload {
  type: 'QUALITY_CHANGE';
  quality: {
    width: number;
    height: number;
    frameRate: number;
    label: string;
  };
}

export interface HeartPayload {
  type: 'HEART';
  heart: {
    id: number;
    x: number;
    y: number;
    color: string;
    tx: number;
  };
}

const SUPPORTED_QUALITIES: readonly QualityChangePayload['quality'][] = [
  { width: 1280, height: 720, frameRate: 30, label: '720p (HD)' },
  { width: 1920, height: 1080, frameRate: 30, label: '1080p (Full HD)' },
  { width: 3840, height: 2160, frameRate: 24, label: '4K (Ultra HD)' },
  { width: 640, height: 480, frameRate: 30, label: '480p (SD)' },
  { width: 480, height: 360, frameRate: 24, label: '360p (Low)' },
];

const QUALITY_KEYS = ['width', 'height', 'frameRate', 'label'] as const;
const HEART_KEYS = ['id', 'x', 'y', 'color', 'tx'] as const;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<PropertyKey, unknown>, expectedKeys: readonly string[]) {
  const actualKeys = Reflect.ownKeys(record);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isQualityChangePayload(payload: unknown): payload is QualityChangePayload {
  if (!isRecord(payload) || !hasExactKeys(payload, ['type', 'quality'])) return false;
  if (payload.type !== 'QUALITY_CHANGE' || !isRecord(payload.quality)) return false;

  const quality = payload.quality;
  if (!hasExactKeys(quality, QUALITY_KEYS)) return false;
  if (
    !isFiniteNumber(quality.width) ||
    !isFiniteNumber(quality.height) ||
    !isFiniteNumber(quality.frameRate) ||
    typeof quality.label !== 'string'
  ) {
    return false;
  }

  return SUPPORTED_QUALITIES.some((supported) => (
    quality.width === supported.width &&
    quality.height === supported.height &&
    quality.frameRate === supported.frameRate &&
    quality.label === supported.label
  ));
}

export function isHeartPayload(payload: unknown): payload is HeartPayload {
  if (!isRecord(payload) || !hasExactKeys(payload, ['type', 'heart'])) return false;
  if (payload.type !== 'HEART' || !isRecord(payload.heart)) return false;

  const heart = payload.heart;
  if (!hasExactKeys(heart, HEART_KEYS)) return false;

  return (
    typeof heart.id === 'number' &&
    Number.isSafeInteger(heart.id) &&
    heart.id >= 0 &&
    isFiniteNumber(heart.x) &&
    heart.x >= 0 &&
    heart.x <= 1 &&
    isFiniteNumber(heart.y) &&
    heart.y >= 0 &&
    heart.y <= 1 &&
    typeof heart.color === 'string' &&
    HEX_COLOR_PATTERN.test(heart.color) &&
    typeof heart.tx === 'number' &&
    Number.isInteger(heart.tx) &&
    heart.tx >= -60 &&
    heart.tx <= 60
  );
}
