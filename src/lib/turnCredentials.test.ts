import { describe, expect, it, vi } from 'vitest';
import {
  loadTurnCredentials,
  parseTurnCredentials,
  resolveTurnCredentialEnvironment,
  turnCredentialRefreshDelayMs,
  turnCredentialRetryDelayMs,
} from './turnCredentials';

const NOW = 1_800_000_000_000;

const validPayload = {
  urls: [
    'turn:turn.example.com:3478?transport=udp',
    'turns:turn.example.com:443?transport=tcp',
  ],
  username: '1800001200:request-id',
  credential: 'temporary-credential',
  expiresAt: NOW + 20 * 60_000,
};

describe('turnCredentials', () => {
  it('accepts a complete unexpired TURN credential response', () => {
    expect(parseTurnCredentials(validPayload, NOW)).toEqual(validPayload);
  });

  it('rejects malformed, non-TURN, and nearly expired responses', () => {
    expect(parseTurnCredentials({ ...validPayload, urls: ['https://example.com'] }, NOW)).toBeNull();
    expect(parseTurnCredentials({ ...validPayload, username: '' }, NOW)).toBeNull();
    expect(parseTurnCredentials({ ...validPayload, credential: '' }, NOW)).toBeNull();
    expect(parseTurnCredentials({ ...validPayload, expiresAt: NOW + 30_000 }, NOW)).toBeNull();
    expect(parseTurnCredentials({ ...validPayload, expiresAt: Number.POSITIVE_INFINITY }, NOW)).toBeNull();
  });

  it('loads and validates credentials from the same-origin endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(loadTurnCredentials({
      endpoint: '/api/turn-credentials',
      fetcher,
      now: () => NOW,
      timeoutMs: 100,
    })).resolves.toEqual(validPayload);
    expect(fetcher).toHaveBeenCalledWith('/api/turn-credentials', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('returns null for endpoint errors, invalid JSON, and request timeout', async () => {
    await expect(loadTurnCredentials({
      fetcher: async () => new Response('', { status: 503 }),
      now: () => NOW,
    })).resolves.toBeNull();

    await expect(loadTurnCredentials({
      fetcher: async () => new Response('not-json', { status: 200 }),
      now: () => NOW,
    })).resolves.toBeNull();

    const timeoutFetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
      init?.signal?.addEventListener('abort', () => resolve(new Response('', { status: 499 })), { once: true });
    }));
    await expect(loadTurnCredentials({
      fetcher: timeoutFetcher,
      now: () => NOW,
      timeoutMs: 5,
    })).resolves.toBeNull();
  });

  it('refreshes one minute before expiration and never returns a negative delay', () => {
    expect(turnCredentialRefreshDelayMs(validPayload, NOW)).toBe(19 * 60_000);
    expect(turnCredentialRefreshDelayMs({ ...validPayload, expiresAt: NOW + 30_000 }, NOW)).toBe(0);
  });

  it('retries dynamic credentials quickly after active failure and slowly behind a static fallback', () => {
    expect(turnCredentialRetryDelayMs({ hasStaticFallback: false, hadDynamicCredentials: false })).toBe(30_000);
    expect(turnCredentialRetryDelayMs({ hasStaticFallback: true, hadDynamicCredentials: true })).toBe(30_000);
    expect(turnCredentialRetryDelayMs({ hasStaticFallback: true, hadDynamicCredentials: false })).toBe(5 * 60_000);
  });

  it('prefers dynamic credentials and otherwise preserves complete static fallback values', () => {
    const staticEnvironment = {
      VITE_TURN_URLS: 'turn:static.example.com:3478',
      VITE_TURN_USERNAME: 'static-user',
      VITE_TURN_CREDENTIAL: 'static-pass',
      VITE_TURN_MODE: 'on',
    };

    expect(resolveTurnCredentialEnvironment(staticEnvironment, validPayload)).toEqual({
      ...staticEnvironment,
      VITE_TURN_URLS: validPayload.urls.join(','),
      VITE_TURN_USERNAME: validPayload.username,
      VITE_TURN_CREDENTIAL: validPayload.credential,
    });
    expect(resolveTurnCredentialEnvironment(staticEnvironment, null)).toEqual(staticEnvironment);
  });
});
