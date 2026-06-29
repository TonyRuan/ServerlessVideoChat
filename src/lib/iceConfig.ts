export type TurnMode = 'off' | 'on' | 'force';

export interface IceConfigEnvironment {
  VITE_TURN_URLS?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
  VITE_TURN_MODE?: string;
}

export const BASE_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function parseTurnMode(value: string | null | undefined): TurnMode | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return 'off';
  if (['1', 'true', 'on', 'yes', 'enabled', 'always'].includes(normalized)) return 'on';
  if (['force', 'relay', 'relay-only'].includes(normalized)) return 'force';

  return null;
}

function turnModeFromLocation(locationToken: string): TurnMode | null {
  const parts = locationToken
    .split('#')
    .flatMap((part) => part.split('?'))
    .map((part) => part.replace(/^[?#&]+/, '').trim())
    .filter(Boolean);

  for (const part of parts) {
    const mode = parseTurnMode(new URLSearchParams(part).get('turn'));
    if (mode) return mode;
  }

  return null;
}

function parseTurnUrls(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

export function hasConfiguredTurnServers(env: IceConfigEnvironment): boolean {
  return parseTurnUrls(env.VITE_TURN_URLS).length > 0;
}

export function currentLocationToken() {
  if (typeof window === 'undefined') return '';
  return `${window.location.search ?? ''}${window.location.hash ?? ''}`;
}

export function resolveTurnMode(env: IceConfigEnvironment, locationToken = currentLocationToken()): TurnMode {
  return turnModeFromLocation(locationToken) ?? parseTurnMode(env.VITE_TURN_MODE) ?? 'on';
}

export function buildPeerRtcConfig(
  env: IceConfigEnvironment,
  locationToken = currentLocationToken()
): RTCConfiguration {
  return buildPeerRtcConfigForMode(env, resolveTurnMode(env, locationToken));
}

export function buildPeerRtcConfigForMode(env: IceConfigEnvironment, mode: TurnMode): RTCConfiguration {
  const iceServers: RTCIceServer[] = [...BASE_ICE_SERVERS];
  const turnUrls = parseTurnUrls(env.VITE_TURN_URLS);

  if (mode !== 'off' && turnUrls.length > 0) {
    const username = env.VITE_TURN_USERNAME;
    const credential = env.VITE_TURN_CREDENTIAL;
    if (username && credential) {
      iceServers.push({ urls: turnUrls, username, credential });
    } else {
      iceServers.push({ urls: turnUrls });
    }
  }

  return {
    iceServers,
    ...(mode === 'force' && turnUrls.length > 0 ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
  };
}
