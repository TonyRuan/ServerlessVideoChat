import { describe, expect, it } from 'vitest';
import { handleTurnCredentialsRequest } from './turn-credentials';

async function readJson(response: Response) {
  return (await response.json()) as {
    urls?: string[];
    username?: string;
    credential?: string;
    expiresAt?: number;
    error?: string;
  };
}

describe('turn-credentials Pages Function', () => {
  it('returns TURN REST credentials with bounded ttl and no-store headers', async () => {
    const response = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', {
        method: 'GET',
        headers: {
          Origin: 'https://svc.example.com',
        },
      }),
      {
        TURN_SHARED_SECRET: 'secret',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp, turns:turn.example.com:443?transport=tcp',
        TURN_CREDENTIAL_TTL_SECONDS: '120',
      },
      {
        now: () => 1_700_000_000_000,
        randomId: () => 'req-123',
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await readJson(response);

    expect(body).toEqual({
      urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:443?transport=tcp'],
      username: '1700000300:req-123',
      credential: 'erWc4DzNsBpm1C4z9vpEUTWCaZ0=',
      expiresAt: 1_700_000_300_000,
    });
  });

  it('rejects non-GET methods', async () => {
    const response = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', { method: 'POST' }),
      {
        TURN_SHARED_SECRET: 'secret',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
      }
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('rejects cross-origin requests when Origin is present and mismatched', async () => {
    const response = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', {
        method: 'GET',
        headers: {
          Origin: 'https://evil.example.com',
        },
      }),
      {
        TURN_SHARED_SECRET: 'secret',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toEqual({ error: 'forbidden' });
  });

  it('allows the Capacitor native origin and returns a narrow CORS header', async () => {
    const response = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', {
        method: 'GET',
        headers: { Origin: 'https://localhost' },
      }),
      {
        TURN_SHARED_SECRET: 'secret',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://localhost');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('returns 503 when required configuration is missing or invalid', async () => {
    const missingSecret = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', { method: 'GET' }),
      {
        TURN_SHARED_SECRET: '',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
      }
    );

    expect(missingSecret.status).toBe(503);
    await expect(readJson(missingSecret)).resolves.toEqual({ error: 'turn_unavailable' });

    const invalidUrls = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', { method: 'GET' }),
      {
        TURN_SHARED_SECRET: 'secret',
        TURN_URLS: 'stun:stun.example.com:3478',
      }
    );

    expect(invalidUrls.status).toBe(503);
    await expect(readJson(invalidUrls)).resolves.toEqual({ error: 'turn_unavailable' });
  });

  it('clamps configured ttl into the supported range', async () => {
    const lowTtlResponse = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', { method: 'GET' }),
      {
        TURN_SHARED_SECRET: 'secret',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
        TURN_CREDENTIAL_TTL_SECONDS: '1',
      },
      {
        now: () => 1_700_000_000_000,
        randomId: () => 'low',
      }
    );

    expect((await readJson(lowTtlResponse)).expiresAt).toBe(1_700_000_300_000);

    const highTtlResponse = await handleTurnCredentialsRequest(
      new Request('https://svc.example.com/api/turn-credentials', { method: 'GET' }),
      {
        TURN_SHARED_SECRET: 'secret',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
        TURN_CREDENTIAL_TTL_SECONDS: '7200',
      },
      {
        now: () => 1_700_000_000_000,
        randomId: () => 'high',
      }
    );

    expect((await readJson(highTtlResponse)).expiresAt).toBe(1_700_003_600_000);
  });
});
