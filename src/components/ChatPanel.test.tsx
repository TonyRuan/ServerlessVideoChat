import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../stores/chatStore';
import { ChatPanel } from './ChatPanel';

const renderPanel = () =>
  renderToStaticMarkup(
    <ChatPanel
      isOpen
      isConnected
      isSecure
      onClose={() => undefined}
      onSend={async () => undefined}
      onAcceptFileTransfer={async () => undefined}
      onDeclineFileTransfer={async () => undefined}
    />
  );

describe('ChatPanel accessibility', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      draftText: '',
    });
  });

  it('renders the open panel as a labelled modal dialog', () => {
    const markup = renderPanel();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="chat-panel-title"');
    expect(markup).toContain('<h2 id="chat-panel-title"');
    expect(markup).toContain('>聊天</h2>');
  });

  it('gives visible icon-only controls Chinese accessible names', () => {
    const markup = renderPanel();

    expect(markup).toContain('aria-label="关闭聊天"');
    expect(markup).toContain('aria-label="选择文件"');
    expect(markup).toContain('aria-label="发送消息"');
  });
});
