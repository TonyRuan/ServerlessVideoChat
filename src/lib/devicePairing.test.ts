import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_IDENTITY_STORAGE_KEY,
  PAIRED_DEVICES_STORAGE_KEY,
  getPairedDeviceDisplayName,
  loadOrCreateDeviceIdentity,
  loadPairedDevices,
  removePairedDevice,
  savePairedDevice,
  updatePairedDeviceName,
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

  it('persists a local display name without losing the reported remote name', () => {
    savePairedDevice({
      sessionId: 'session-one',
      pairingSecret: 'pairing-secret-that-is-long-enough-111111',
      role: 'host',
      localPeerId: 'svc-local',
      remotePeerId: 'svc-phone',
      remoteName: '我的手机',
      createdAt: 100,
      lastOpenedAt: 100,
    });

    const renamed = updatePairedDeviceName({ sessionId: 'session-one', name: '  客厅平板  ' });
    expect(renamed).toMatchObject({ remoteName: '我的手机', customName: '客厅平板' });
    expect(getPairedDeviceDisplayName(loadPairedDevices()[0])).toBe('客厅平板');

    updatePairedDeviceRemote({
      sessionId: 'session-one',
      remotePeerId: 'svc-phone-new',
      remoteName: '对方手机',
    });
    const refreshed = loadPairedDevices()[0];
    expect(refreshed).toMatchObject({ remoteName: '对方手机', customName: '客厅平板' });
    expect(getPairedDeviceDisplayName(refreshed)).toBe('客厅平板');

    const sessionRefresh = { ...refreshed };
    delete sessionRefresh.customName;
    savePairedDevice({ ...sessionRefresh, lastOpenedAt: 5678 });
    expect(loadPairedDevices()[0]).toMatchObject({ customName: '客厅平板', lastOpenedAt: 5678 });

    expect(updatePairedDeviceName({ sessionId: 'session-one', name: '   ' })).toBeNull();
    expect(getPairedDeviceDisplayName(loadPairedDevices()[0])).toBe('客厅平板');
  });
});
