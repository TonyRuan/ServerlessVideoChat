import type { CallSessionRole } from './callSession';

export const DEVICE_PAIRING_STORAGE_VERSION = 1;
export const DEVICE_IDENTITY_STORAGE_KEY = 'serverlessVideoChat:deviceIdentity:v1';
export const PAIRED_DEVICES_STORAGE_KEY = 'serverlessVideoChat:pairedDevices:v1';
export const MAX_DEVICE_NAME_LENGTH = 48;

export interface DeviceIdentity {
  id: string;
  peerId: string;
  name: string;
  createdAt: number;
}

export interface PairedDeviceSession {
  sessionId: string;
  pairingSecret: string;
  role: CallSessionRole;
  localPeerId: string;
  remotePeerId?: string;
  remoteName: string;
  customName?: string;
  createdAt: number;
  lastOpenedAt: number;
}

interface StoredDeviceIdentity {
  version: typeof DEVICE_PAIRING_STORAGE_VERSION;
  identity: DeviceIdentity;
}

interface StoredPairedDevices {
  version: typeof DEVICE_PAIRING_STORAGE_VERSION;
  devices: PairedDeviceSession[];
}

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const isValidDeviceName = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_DEVICE_NAME_LENGTH
);

const createToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
};

const defaultDeviceName = () => {
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) {
    return '我的手机';
  }
  return '我的电脑';
};

const isDeviceIdentity = (value: unknown): value is DeviceIdentity => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' && SAFE_TOKEN_PATTERN.test(record.id) &&
    typeof record.peerId === 'string' && SAFE_TOKEN_PATTERN.test(record.peerId) &&
    isValidDeviceName(record.name) &&
    typeof record.createdAt === 'number' && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0
  );
};

const isPairedDeviceSession = (value: unknown): value is PairedDeviceSession => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === 'string' && SAFE_TOKEN_PATTERN.test(record.sessionId) &&
    typeof record.pairingSecret === 'string' && SAFE_TOKEN_PATTERN.test(record.pairingSecret) && record.pairingSecret.length >= 32 &&
    (record.role === 'host' || record.role === 'guest') &&
    typeof record.localPeerId === 'string' && SAFE_TOKEN_PATTERN.test(record.localPeerId) &&
    (record.remotePeerId === undefined || (typeof record.remotePeerId === 'string' && SAFE_TOKEN_PATTERN.test(record.remotePeerId))) &&
    isValidDeviceName(record.remoteName) &&
    (record.customName === undefined || isValidDeviceName(record.customName)) &&
    typeof record.createdAt === 'number' && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0 &&
    typeof record.lastOpenedAt === 'number' && Number.isSafeInteger(record.lastOpenedAt) && record.lastOpenedAt >= 0
  );
};

const readStorage = (key: string) => {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Pairing remains usable for the current page even when storage is unavailable.
  }
};

export function createDeviceIdentity(name = defaultDeviceName()): DeviceIdentity {
  const id = createToken();
  return {
    id,
    peerId: `svc-${id}`,
    name,
    createdAt: Date.now(),
  };
}

export function createPairingSecret() {
  return createToken() + createToken();
}

export function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const stored = readStorage(DEVICE_IDENTITY_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as StoredDeviceIdentity;
      if (parsed.version === DEVICE_PAIRING_STORAGE_VERSION && isDeviceIdentity(parsed.identity)) {
        return parsed.identity;
      }
    } catch {
      // Replace invalid legacy or partial state below.
    }
  }

  const identity = createDeviceIdentity();
  writeStorage(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify({
    version: DEVICE_PAIRING_STORAGE_VERSION,
    identity,
  } satisfies StoredDeviceIdentity));
  return identity;
}

export function loadPairedDevices(): PairedDeviceSession[] {
  const stored = readStorage(PAIRED_DEVICES_STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as StoredPairedDevices;
    if (parsed.version !== DEVICE_PAIRING_STORAGE_VERSION || !Array.isArray(parsed.devices)) return [];
    return parsed.devices.filter(isPairedDeviceSession).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

export function savePairedDevice(device: PairedDeviceSession) {
  if (!isPairedDeviceSession(device)) return;
  const devices = loadPairedDevices();
  const existing = devices.find((item) => item.sessionId === device.sessionId);
  const persistedDevice = !Object.prototype.hasOwnProperty.call(device, 'customName') && existing?.customName
    ? { ...device, customName: existing.customName }
    : device;
  const next = [persistedDevice, ...devices.filter((item) => item.sessionId !== device.sessionId)]
    .slice(0, 8);
  writeStorage(PAIRED_DEVICES_STORAGE_KEY, JSON.stringify({
    version: DEVICE_PAIRING_STORAGE_VERSION,
    devices: next,
  } satisfies StoredPairedDevices));
}

export function getPairedDeviceDisplayName(device: PairedDeviceSession) {
  return device.customName?.trim() || device.remoteName;
}

export function updatePairedDeviceName({
  sessionId,
  name,
}: {
  sessionId: string;
  name: string;
}): PairedDeviceSession | null {
  const customName = name.trim();
  if (!isValidDeviceName(customName)) return null;

  const existing = loadPairedDevices().find((item) => item.sessionId === sessionId);
  if (!existing) return null;

  const updated = {
    ...existing,
    customName: customName === existing.remoteName ? undefined : customName,
  } satisfies PairedDeviceSession;
  savePairedDevice(updated);
  return updated;
}

export function updatePairedDeviceRemote({
  sessionId,
  remotePeerId,
  remoteName,
}: {
  sessionId: string;
  remotePeerId: string;
  remoteName?: string;
}) {
  const existing = loadPairedDevices().find((item) => item.sessionId === sessionId);
  if (!existing) return;
  savePairedDevice({
    ...existing,
    remotePeerId,
    remoteName: remoteName?.trim() || existing.remoteName,
    lastOpenedAt: Date.now(),
  });
}

export function removePairedDevice(sessionId: string) {
  const devices = loadPairedDevices().filter((item) => item.sessionId !== sessionId);
  writeStorage(PAIRED_DEVICES_STORAGE_KEY, JSON.stringify({
    version: DEVICE_PAIRING_STORAGE_VERSION,
    devices,
  } satisfies StoredPairedDevices));
}
