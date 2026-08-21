import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_APP_URL,
  resolvePublicAppBaseUrl,
  resolveTurnCredentialsEndpoint,
} from './runtimeUrls';

describe('runtime URL resolution', () => {
  it('uses the hosted app URL for native invite links and TURN credentials', () => {
    const baseUrl = resolvePublicAppBaseUrl({
      isNative: true,
      origin: 'https://localhost',
      basePath: '/',
    });

    expect(baseUrl).toBe(DEFAULT_PUBLIC_APP_URL);
    expect(resolveTurnCredentialsEndpoint({
      isNative: true,
      publicAppBaseUrl: baseUrl,
    })).toBe('https://chat.uavserver.cn/api/turn-credentials');
  });

  it('keeps browser invites on the current deployment base path', () => {
    expect(resolvePublicAppBaseUrl({
      isNative: false,
      origin: 'https://example.com',
      basePath: '/ServerlessVideoChat/',
    })).toBe('https://example.com/ServerlessVideoChat/');
  });

  it('prefers explicit build-time overrides', () => {
    expect(resolvePublicAppBaseUrl({
      configuredUrl: 'https://chat.example.com/app',
      isNative: true,
      origin: 'https://localhost',
      basePath: '/',
    })).toBe('https://chat.example.com/app/');

    expect(resolveTurnCredentialsEndpoint({
      configuredEndpoint: 'https://turn.example.com/credentials',
      isNative: true,
      publicAppBaseUrl: DEFAULT_PUBLIC_APP_URL,
    })).toBe('https://turn.example.com/credentials');
  });
});
