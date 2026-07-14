import type { IceConfigEnvironment } from './iceConfig';

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface LoadTurnCredentialsOptions {
  endpoint?: string;
  fetcher?: Fetcher;
  now?: () => number;
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = '/api/turn-credentials';
const DEFAULT_TIMEOUT_MS = 3_000;
const MIN_VALIDITY_MS = 60_000;
const REFRESH_LEAD_MS = 60_000;
const ACTIVE_CREDENTIAL_RETRY_MS = 30_000;
const STATIC_FALLBACK_RETRY_MS = 5 * 60_000;
const TURN_URL_PATTERN = /^turns?:(?:\/\/)?(?:\[[0-9a-f:]+\]|[^\s/:?,]+)(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const urls = [...new Set(value.map((url) => typeof url === 'string' ? url.trim() : ''))];
  if (urls.some((url) => !TURN_URL_PATTERN.test(url))) return null;
  return urls;
}

export function parseTurnCredentials(
  value: unknown,
  now = Date.now(),
  minimumValidityMs = MIN_VALIDITY_MS
): TurnCredentials | null {
  if (!isRecord(value)) return null;

  const urls = parseUrls(value.urls);
  const username = typeof value.username === 'string' ? value.username.trim() : '';
  const credential = typeof value.credential === 'string' ? value.credential.trim() : '';
  const expiresAt = value.expiresAt;

  if (!urls || !username || !credential) return null;
  if (username.length > 512 || credential.length > 1024) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  if (expiresAt < now + minimumValidityMs) return null;

  return { urls, username, credential, expiresAt };
}

export async function loadTurnCredentials({
  endpoint = DEFAULT_ENDPOINT,
  fetcher = fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: LoadTurnCredentialsOptions = {}): Promise<TurnCredentials | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseTurnCredentials(await response.json(), now());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function turnCredentialRefreshDelayMs(credentials: TurnCredentials, now = Date.now()) {
  return Math.max(0, credentials.expiresAt - now - REFRESH_LEAD_MS);
}

export function turnCredentialRetryDelayMs({
  hasStaticFallback,
  hadDynamicCredentials,
}: {
  hasStaticFallback: boolean;
  hadDynamicCredentials: boolean;
}) {
  return !hasStaticFallback || hadDynamicCredentials
    ? ACTIVE_CREDENTIAL_RETRY_MS
    : STATIC_FALLBACK_RETRY_MS;
}

export function resolveTurnCredentialEnvironment(
  staticEnvironment: IceConfigEnvironment,
  credentials: TurnCredentials | null
): IceConfigEnvironment {
  if (!credentials) return { ...staticEnvironment };

  return {
    ...staticEnvironment,
    VITE_TURN_URLS: credentials.urls.join(','),
    VITE_TURN_USERNAME: credentials.username,
    VITE_TURN_CREDENTIAL: credentials.credential,
  };
}
