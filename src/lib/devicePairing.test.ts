import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_IDENTITY_STORAGE_KEY,
  PAIRED_DEVICES_STORAGE_KEY,
  loadOrCreateDeviceIdentity,
  loadPairedDevices,
  removePairedDevice,
  savePairedDevice,
  updatePairedDeviceRemote,
} from './devicePairing';

const originalLocalStorage = globalThis.localStorage;

function installMemoryStorage() {
  const entries = new Map<string, string>();
  const storage = {
    get length() { return entries.size; },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
    clear: () => entries.clear(),
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  return entries;
}

describe('devicePairing', () => {
  beforeEach(() => {
    installMemoryStorage();
    vi.spyOn(Date, 'now').mockReturnValue(1234);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true });
  });

  it('creates and reuses a stable URL-safe PeerJS identity', () => {
    const first = loadOrCreateDeviceIdentity();
    const second = loadOrCreateDeviceIdentity();

    expect(second).toEqual(first);
    expect(first.peerId).toMatch(/^svc-[A-Za-z0-9_-]+$/);
    expect(localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)).toContain(first.peerId);
  });

  it('upserts, completes, sorts, and removes paired sessions', () => {
    savePairedDevice({
      sessionId: 'session-one',
      pairingSecret: 'pairing-secret-that-is-long-enough-111111',
      role: 'host',
      localPeerId: 'svc-local',
      remoteName: '我的手机',
      createdAt: 100,
      lastOpenedAt: 100,
    });
    savePairedDevice({
      sessionId: 'session-two',
      pairingSecret: 'pairing-secret-that-is-long-enough-222222',
      role: 'guest',
      localPeerId: 'svc-local',
      remotePeerId: 'svc-computer',
      remoteName: '我的电脑',
      createdAt: 200,
      lastOpenedAt: 200,
    });

    updatePairedDeviceRemote({ sessionId: 'session-one', remotePeerId: 'svc-phone' });

    expect(loadPairedDevices().map((item) => item.sessionId)).toEqual(['session-one', 'session-two']);
    expect(loadPairedDevices()[0]).toMatchObject({ remotePeerId: 'svc-phone', lastOpenedAt: 1234 });

    removePairedDevice('session-one');
    expect(loadPairedDevices()).toHaveLength(1);
    expect(localStorage.getItem(PAIRED_DEVICES_STORAGE_KEY)).not.toContain('session-one');
  });

  it('ignores malformed persisted state', () => {
    localStorage.setItem(PAIRED_DEVICES_STORAGE_KEY, '{broken');
    expect(loadPairedDevices()).toEqual([]);
  });
});
