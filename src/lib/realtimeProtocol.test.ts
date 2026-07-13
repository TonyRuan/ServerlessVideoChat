import { describe, expect, it } from 'vitest';
import {
  isHeartPayload,
  isQualityChangePayload,
  type HeartPayload,
  type QualityChangePayload,
} from './realtimeProtocol';

const VALID_QUALITIES: QualityChangePayload['quality'][] = [
  { width: 1280, height: 720, frameRate: 30, label: '720p (HD)' },
  { width: 1920, height: 1080, frameRate: 30, label: '1080p (Full HD)' },
  { width: 3840, height: 2160, frameRate: 24, label: '4K (Ultra HD)' },
  { width: 640, height: 480, frameRate: 30, label: '480p (SD)' },
  { width: 480, height: 360, frameRate: 24, label: '360p (Low)' },
];

const validHeart: HeartPayload = {
  type: 'HEART',
  heart: {
    id: 0,
    x: 0.5,
    y: 0.25,
    color: '#ff69B4',
    tx: -12,
  },
};

describe('isQualityChangePayload', () => {
  it.each(VALID_QUALITIES)('accepts the exact supported quality $label', (quality) => {
    expect(isQualityChangePayload({ type: 'QUALITY_CHANGE', quality })).toBe(true);
  });

  it('rejects unsupported quality combinations and label mismatches', () => {
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { width: 2560, height: 1440, frameRate: 30, label: '1440p' },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { ...VALID_QUALITIES[0], label: '720p' },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { ...VALID_QUALITIES[0], frameRate: 24 },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { ...VALID_QUALITIES[0], width: 1920 },
    })).toBe(false);
  });

  it('rejects non-finite numbers, missing fields, and extra fields', () => {
    expect(isQualityChangePayload(null)).toBe(false);
    expect(isQualityChangePayload({ type: 'QUALITY_CHANGE' })).toBe(false);
    expect(isQualityChangePayload({ type: 'QUALITY_CHANGE', quality: null })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { width: 1280, height: 720, frameRate: 30 },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { ...VALID_QUALITIES[0], width: Number.NaN },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { ...VALID_QUALITIES[0], height: Number.POSITIVE_INFINITY },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { ...VALID_QUALITIES[0], frameRate: Number.NEGATIVE_INFINITY },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: { ...VALID_QUALITIES[0], codec: 'vp9' },
    })).toBe(false);
    expect(isQualityChangePayload({
      type: 'QUALITY_CHANGE',
      quality: VALID_QUALITIES[0],
      extra: true,
    })).toBe(false);
  });
});

describe('isHeartPayload', () => {
  it('accepts valid hearts including numeric boundaries', () => {
    expect(isHeartPayload(validHeart)).toBe(true);
    expect(isHeartPayload({
      type: 'HEART',
      heart: {
        id: Number.MAX_SAFE_INTEGER,
        x: 0,
        y: 1,
        color: '#ABCDEF',
        tx: 60,
      },
    })).toBe(true);
    expect(isHeartPayload({
      type: 'HEART',
      heart: { ...validHeart.heart, tx: -60 },
    })).toBe(true);
  });

  it.each(['id', 'x', 'y', 'tx'] as const)('rejects non-finite %s values', (field) => {
    expect(isHeartPayload({
      ...validHeart,
      heart: { ...validHeart.heart, [field]: Number.NaN },
    })).toBe(false);
    expect(isHeartPayload({
      ...validHeart,
      heart: { ...validHeart.heart, [field]: Number.POSITIVE_INFINITY },
    })).toBe(false);
  });

  it('rejects invalid ids, coordinates, and horizontal travel', () => {
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, id: -1 } })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, id: 1.5 } })).toBe(false);
    expect(isHeartPayload({
      ...validHeart,
      heart: { ...validHeart.heart, id: Number.MAX_SAFE_INTEGER + 1 },
    })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, x: -0.001 } })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, x: 1.001 } })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, y: -0.001 } })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, y: 1.001 } })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, tx: -61 } })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, tx: 61 } })).toBe(false);
    expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, tx: 0.5 } })).toBe(false);
  });

  it.each(['ff69b4', '#fff', '#ff69b4aa', '#gg69b4', ' #ff69b4', '#ff69b4 '])(
    'rejects invalid six-digit hexadecimal color %s',
    (color) => {
      expect(isHeartPayload({ ...validHeart, heart: { ...validHeart.heart, color } })).toBe(false);
    },
  );

  it('rejects malformed, incomplete, and extended heart payloads', () => {
    expect(isHeartPayload(undefined)).toBe(false);
    expect(isHeartPayload({ type: 'HEART' })).toBe(false);
    expect(isHeartPayload({ type: 'HEART', heart: null })).toBe(false);
    expect(isHeartPayload({
      type: 'HEART',
      heart: { id: 1, x: 0.5, y: 0.5, color: '#ff69b4' },
    })).toBe(false);
    expect(isHeartPayload({
      ...validHeart,
      heart: { ...validHeart.heart, opacity: 1 },
    })).toBe(false);
    expect(isHeartPayload({ ...validHeart, extra: true })).toBe(false);
  });
});
