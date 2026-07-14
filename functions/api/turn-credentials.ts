type TurnCredentialEnv = {
  TURN_SHARED_SECRET?: string;
  TURN_URLS?: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
};

type PagesFunctionContext<TEnv> = {
  request: Request;
  env: TEnv;
};

type PagesFunction<TEnv> = (context: PagesFunctionContext<TEnv>) => Response | Promise<Response>;

type TurnCredentialOptions = {
  now?: () => number;
  randomId?: () => string;
};

const DEFAULT_TTL_SECONDS = 1200;
const MIN_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;
const NO_STORE_CACHE_CONTROL = 'no-store';

export const onRequest: PagesFunction<TurnCredentialEnv> = ({ request, env }) =>
  handleTurnCredentialsRequest(request, env);

export async function handleTurnCredentialsRequest(
  request: Request,
  env: TurnCredentialEnv,
  options: TurnCredentialOptions = {}
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, {
      Allow: 'GET',
    });
  }

  const requestOrigin = new URL(request.url).origin;
  const originHeader = request.headers.get('origin');
  if (originHeader && originHeader !== requestOrigin) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  const secret = env.TURN_SHARED_SECRET?.trim() ?? '';
  const urls = parseTurnUrls(env.TURN_URLS);
  if (!secret || urls.length === 0) {
    return jsonResponse({ error: 'turn_unavailable' }, 503);
  }

  const ttlSeconds = resolveTtlSeconds(env.TURN_CREDENTIAL_TTL_SECONDS);
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? createRandomId;
  const expiresAtSeconds = Math.floor(now() / 1000) + ttlSeconds;
  const username = `${expiresAtSeconds}:${randomId()}`;
  const credential = await signTurnUsername(secret, username);

  return jsonResponse(
    {
      urls,
      username,
      credential,
      expiresAt: expiresAtSeconds * 1000,
    },
    200
  );
}

function parseTurnUrls(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('turn:') || entry.startsWith('turns:'));
}

function resolveTtlSeconds(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TTL_SECONDS;
  }

  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, parsed));
}

async function signTurnUsername(secret: string, username: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto is unavailable');
  }

  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-1',
    },
    false,
    ['sign']
  );
  const signature = await subtle.sign('HMAC', key, encoder.encode(username));
  return toBase64(new Uint8Array(signature));
}

function createRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return globalThis.btoa(binary);
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': NO_STORE_CACHE_CONTROL,
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
