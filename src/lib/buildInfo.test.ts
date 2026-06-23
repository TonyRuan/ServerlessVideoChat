import { describe, expect, it } from 'vitest';
import { formatBuildTime } from './buildInfo';

describe('buildInfo', () => {
  it('formats ISO build timestamps for compact display', () => {
    expect(formatBuildTime('2026-06-23T02:03:04.000Z')).toMatch(/^2026-06-23 \d{2}:03$/);
  });

  it('falls back for invalid timestamps', () => {
    expect(formatBuildTime('')).toBe('-');
    expect(formatBuildTime('not-a-date')).toBe('not-a-date');
  });
});
