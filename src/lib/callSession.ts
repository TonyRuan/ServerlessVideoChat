export type CallSessionRole = 'host' | 'guest';

export interface CallSessionState {
  sessionId: string;
  role: CallSessionRole;
  peerId?: string;
}

export interface ParsedInviteInput {
  peerId: string;
  sessionId: string;
}

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const SAFE_PEER_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;

export function createCallSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isValidCallSessionId(value: string) {
  return SAFE_TOKEN_PATTERN.test(value);
}

export function isValidPeerId(value: string) {
  return SAFE_PEER_ID_PATTERN.test(value);
}

function normalizeRole(value: string | null): CallSessionRole {
  return value === 'guest' ? 'guest' : 'host';
}

export function parseCallSessionHash(hash: string): CallSessionState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const sessionId = params.get('session') ?? '';
  if (!isValidCallSessionId(sessionId)) return null;

  const peerId = params.get('peer') ?? '';
  return {
    sessionId,
    role: normalizeRole(params.get('role')),
    ...(peerId && isValidPeerId(peerId) ? { peerId } : {}),
  };
}

export function resolveCallSessionState(
  hash: string,
  current: CallSessionState,
  activePeerId?: string
): CallSessionState {
  const parsed = parseCallSessionHash(hash) ?? current;
  const peerId = activePeerId ?? parsed.peerId ?? current.peerId;

  return {
    sessionId: parsed.sessionId,
    role: parsed.role,
    ...(peerId ? { peerId } : {}),
  };
}

export function parseInviteInput(input: string): ParsedInviteInput | null {
  const normalizedInput = input.trim();
  if (!/^https?:\/\//i.test(normalizedInput)) return null;

  let url: URL;
  try {
    url = new URL(normalizedInput);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const pathMatch = url.pathname.match(/(?:^|\/)call\/([^/]+)\/?$/);
  if (!pathMatch) return null;

  let peerId: string;
  try {
    peerId = decodeURIComponent(pathMatch[1]);
  } catch {
    return null;
  }

  if (!isValidPeerId(peerId)) return null;

  const session = parseCallSessionHash(url.hash);
  if (!session) return null;

  return {
    peerId,
    sessionId: session.sessionId,
  };
}

export function buildCallSessionHash({ sessionId, role, peerId }: CallSessionState) {
  const params = new URLSearchParams();
  params.set('session', sessionId);
  params.set('role', role);
  if (peerId) params.set('peer', peerId);
  return `#${params.toString()}`;
}

export function buildInviteLink(baseUrl: string, hostPeerId: string, sessionId: string) {
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${cleanBaseUrl}/call/${hostPeerId}${buildCallSessionHash({ sessionId, role: 'guest' })}`;
}
