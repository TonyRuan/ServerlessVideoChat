export interface ChatPanelPosition {
  x: number;
  y: number;
}

export interface ChatPanelBounds {
  width: number;
  height: number;
}

export interface ChatPanelPositionStyle {
  left: number;
  top: number;
  right: 'auto';
  bottom: 'auto';
  height: number;
}

const CHAT_PANEL_POSITION_KEY = 'serverlessVideoChat:chatPanelPosition:v1';
const PANEL_MARGIN = 16;

export function clampChatPanelPosition(
  position: ChatPanelPosition,
  viewport: ChatPanelBounds,
  panel: ChatPanelBounds
): ChatPanelPosition {
  const maxX = Math.max(PANEL_MARGIN, viewport.width - panel.width - PANEL_MARGIN);
  const maxY = Math.max(PANEL_MARGIN, viewport.height - panel.height - PANEL_MARGIN);

  return {
    x: Math.min(Math.max(position.x, PANEL_MARGIN), maxX),
    y: Math.min(Math.max(position.y, PANEL_MARGIN), maxY),
  };
}

export function createChatPanelPositionStyle(
  position: ChatPanelPosition,
  panelHeight: number
): ChatPanelPositionStyle {
  return {
    left: position.x,
    top: position.y,
    right: 'auto',
    bottom: 'auto',
    height: panelHeight,
  };
}

export function loadChatPanelPosition(): ChatPanelPosition | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(CHAT_PANEL_POSITION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ChatPanelPosition>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;

    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

export function saveChatPanelPosition(position: ChatPanelPosition) {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(CHAT_PANEL_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Panel placement is a preference; persistence is best-effort.
  }
}
