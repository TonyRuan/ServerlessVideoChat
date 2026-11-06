import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, FileTransferMode } from '../lib/chatStorage';
import { useChatStore } from '../stores/chatStore';
import { ChatPanel, FileTransferModeSelector } from './ChatPanel';

vi.mock('../stores/chatStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/chatStore')>();
  // SSR normally reads Zustand's initial snapshot; render each test's supplied state instead.
  const useChatStore = Object.assign(
    <T,>(selector: (state: ReturnType<typeof actual.useChatStore.getState>) => T) => selector(actual.useChatStore.getState()),
    actual.useChatStore
  );
  return { ...actual, useChatStore };
});

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

  it('keeps the file mode selector out of the empty message composer', () => {
    expect(renderPanel()).not.toContain('文件传输模式');
  });

  it('explains a received fast transfer before the accept action', () => {
    useChatStore.setState({ messages: [makeFileMessage('fast')] });

    const markup = renderPanel();

    expect(markup).toContain('极速模式');
    expect(markup).toContain('跳过额外文件加密，仍有 WebRTC 传输加密。');
    expect(markup.indexOf('跳过额外文件加密')).toBeLessThan(markup.indexOf('>接受</button>'));
    expect(markup).toContain('>拒绝</button>');
  });

  it('labels legacy file offers as encrypted when no mode was recorded', () => {
    useChatStore.setState({ messages: [makeFileMessage()] });

    const markup = renderPanel();

    expect(markup).toContain('加密模式');
    expect(markup).not.toContain('极速模式');
    expect(markup).toContain('>接受</button>');
  });

  it('explains relay routing and end-to-end encryption before accepting lightning', () => {
    useChatStore.setState({ messages: [makeFileMessage('lightning')] });
    const markup = renderPanel();
    expect(markup).toContain('实验闪电模式');
    expect(markup).toContain('经服务器中转，文件仍端到端加密。');
    expect(markup.indexOf('经服务器中转')).toBeLessThan(markup.indexOf('>接受</button>'));
    expect(markup).not.toContain('跳过额外文件加密');
  });

  it('keeps the mode visible on completed downloadable file cards', () => {
    const message = makeFileMessage('fast');
    message.direction = 'out';
    message.file!.objectUrl = 'blob:received-file';
    message.fileTransfer!.status = 'sent';
    useChatStore.setState({ messages: [message] });

    const markup = renderPanel();

    expect(markup).toContain('download="report.zip"');
    expect(markup).toContain('极速模式');
    expect(markup).not.toContain('>接受</button>');
  });
});

const makeFileMessage = (mode?: FileTransferMode): ChatMessage => ({
  id: 'file-message',
  conversationId: 'test-conversation',
  direction: 'in',
  kind: 'file',
  file: { name: 'report.zip', mimeType: 'application/zip', size: 1024 },
  fileTransfer: { id: 'transfer-1', status: 'offered', bytesTransferred: 0, mode },
  createdAt: 1_000,
  status: 'received',
});

describe('FileTransferModeSelector', () => {
  it('groups both modes under a visible accessible label and explains extra encryption', () => {
    const markup = renderToStaticMarkup(<FileTransferModeSelector mode="encrypted" onChange={() => undefined} />);

    expect(markup).toContain('<legend');
    expect(markup).toContain('文件传输模式</legend>');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('加密模式</label>');
    expect(markup).toContain('极速模式</label>');
    expect(markup.match(/<input[^>]*value="encrypted"[^>]*>/)?.[0]).toContain('checked');
    expect(markup.match(/<input[^>]*value="fast"[^>]*>/)?.[0]).not.toContain('checked');
    expect(markup).toContain('在 WebRTC 传输加密之上，额外加密文件内容。');
  });

  it('describes the selected fast mode accurately and locks selection during sending', () => {
    const markup = renderToStaticMarkup(<FileTransferModeSelector mode="fast" onChange={() => undefined} disabled />);

    expect(markup.match(/<fieldset[^>]*>/)?.[0]).toContain('disabled');
    expect(markup.match(/<input[^>]*value="fast"[^>]*>/)?.[0]).toContain('checked');
    expect(markup).toContain('跳过额外文件加密，仍有 WebRTC 传输加密。');
    expect(markup).toContain('实际速度取决于网络和设备。');
  });

  it('describes lightning without promising speed or dropping encryption', () => {
    const markup = renderToStaticMarkup(<FileTransferModeSelector mode="lightning" onChange={() => undefined} />);
    expect(markup.match(/<input[^>]*value="lightning"[^>]*>/)?.[0]).toContain('checked');
    expect(markup).toContain('经服务器中转，文件仍端到端加密。实验功能，失败可改用其他模式重试。');
    expect(markup).not.toContain('跳过额外文件加密');
  });

  it('disables only lightning when unavailable and associates the reason with its radio', () => {
    const markup = renderToStaticMarkup(<FileTransferModeSelector mode="encrypted" onChange={() => undefined} lightningUnavailableReason="对方尚未支持闪电模式" />);
    const radio = markup.match(/<input[^>]*value="lightning"[^>]*>/)?.[0];
    expect(radio).toContain('disabled');
    expect(radio).toContain('aria-describedby=');
    expect(markup).toContain('实验闪电模式不可用：对方尚未支持闪电模式');
    expect(markup.match(/<input[^>]*value="encrypted"[^>]*>/)?.[0]).not.toContain('disabled');
    expect(markup.match(/<input[^>]*value="fast"[^>]*>/)?.[0]).not.toContain('disabled');
  });
});
