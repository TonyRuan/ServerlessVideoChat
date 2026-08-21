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
    expect(markup).toContain('aria-label="选择图片或文件"');
    expect(markup).toContain('aria-label="发送消息"');
  });

  it('keeps persistent text messages queueable while the paired device is offline', () => {
    useChatStore.setState({ draftText: '稍后发送' });
    const markup = renderToStaticMarkup(
      <ChatPanel
        isOpen
        isConnected={false}
        isSecure={false}
        isPersistent
        peerLabel="我的电脑"
        onClose={() => undefined}
        onSend={async () => undefined}
        onAcceptFileTransfer={async () => undefined}
        onDeclineFileTransfer={async () => undefined}
      />
    );

    expect(markup).toContain('与 我的电脑 的会话');
    expect(markup).toContain('离线 · 文字和图片将在重连后发送');
    expect(markup).toContain('输入消息，设备上线后自动发送');
    expect(markup.match(/<textarea[^>]*placeholder="输入消息，设备上线后自动发送"[^>]*>/)?.[0]).not.toContain('disabled');
    expect(markup).toContain('title="加入待发送队列"');
  });
});
