import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_PAIRING_STORAGE_VERSION, PAIRED_DEVICES_STORAGE_KEY } from '../lib/devicePairing';
import Home from './Home';

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => vi.fn(),
}));

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
  return storage;
}

describe('Home', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true });
  });

  it('waits for an explicit preview action before acquiring media', () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('启动设备预览');
    expect(markup.match(/<button[^>]*aria-label="关闭麦克风"[^>]*>/)?.[0]).not.toMatch(/\sdisabled(?:=|>)/);
    expect(markup.match(/<button[^>]*aria-label="关闭摄像头"[^>]*>/)?.[0]).not.toMatch(/\sdisabled(?:=|>)/);
    expect(markup).not.toContain('初始化摄像头');
  });

  it('renders a paired device custom name and an accessible edit action', () => {
    const storage = installMemoryStorage();
    storage.setItem(PAIRED_DEVICES_STORAGE_KEY, JSON.stringify({
      version: DEVICE_PAIRING_STORAGE_VERSION,
      devices: [{
        sessionId: 'session-one',
        pairingSecret: 'pairing-secret-that-is-long-enough-111111',
        role: 'host',
        localPeerId: 'svc-local',
        remotePeerId: 'svc-computer',
        remoteName: '我的电脑',
        customName: '书房电脑',
        createdAt: 100,
        lastOpenedAt: 100,
      }],
    }));

    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('书房电脑');
    expect(markup).toContain('aria-label="编辑设备名称 书房电脑"');
    expect(markup).toContain('aria-label="取消配对 书房电脑"');
  });
});
