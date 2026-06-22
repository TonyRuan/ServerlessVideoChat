import { describe, expect, it } from 'vitest';
import {
  clampChatPanelPosition,
  createChatPanelPositionStyle,
  loadChatPanelPosition,
  saveChatPanelPosition,
  type ChatPanelPosition,
} from './chatPanelPosition';

describe('chatPanelPosition', () => {
  it('clamps panel position inside viewport bounds', () => {
    expect(
      clampChatPanelPosition(
        { x: -100, y: 900 },
        { width: 1000, height: 800 },
        { width: 360, height: 420 }
      )
    ).toEqual({ x: 16, y: 364 });

    expect(
      clampChatPanelPosition(
        { x: 950, y: -20 },
        { width: 1000, height: 800 },
        { width: 360, height: 420 }
      )
    ).toEqual({ x: 624, y: 16 });
  });

  it('keeps a usable origin when viewport is smaller than the panel', () => {
    expect(
      clampChatPanelPosition(
        { x: 40, y: 40 },
        { width: 320, height: 300 },
        { width: 360, height: 420 }
      )
    ).toEqual({ x: 16, y: 16 });
  });

  it('keeps a fixed height when the panel is positioned by dragging', () => {
    expect(createChatPanelPositionStyle({ x: 120, y: 180 }, 460)).toEqual({
      left: 120,
      top: 180,
      right: 'auto',
      bottom: 'auto',
      height: 460,
    });
  });

  it('saves and loads the last panel position from localStorage', () => {
    const originalLocalStorage = globalThis.localStorage;
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;

    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

    const position: ChatPanelPosition = { x: 120, y: 180 };
    saveChatPanelPosition(position);

    expect(loadChatPanelPosition()).toEqual(position);

    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it('returns null instead of throwing when stored position is unavailable or malformed', () => {
    const originalLocalStorage = globalThis.localStorage;
    const storage = {
      getItem: () => '{bad json',
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    } as unknown as Storage;

    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

    expect(loadChatPanelPosition()).toBeNull();
    expect(() => saveChatPanelPosition({ x: 10, y: 20 })).not.toThrow();

    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });
});
