import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CallIssuePanel } from './CallIssuePanel';
import { ConnectionStatusNotice } from './ConnectionStatusNotice';

describe('call issue UI', () => {
  it('renders actionable blocking errors with distinct actions', () => {
    const markup = renderToStaticMarkup(
      <CallIssuePanel
        title="无法使用摄像头或麦克风"
        message="请允许设备权限后重试。"
        primaryAction={{ label: '重试设备', onClick: vi.fn() }}
        secondaryAction={{ label: '关闭音视频继续', onClick: vi.fn() }}
      />
    );

    expect(markup).toContain('重试设备');
    expect(markup).toContain('关闭音视频继续');
  });

  it('keeps transient connection errors non-blocking and retryable', () => {
    const markup = renderToStaticMarkup(
      <ConnectionStatusNotice message="信令服务暂时断开" onRetry={vi.fn()} />
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('立即重试');
  });
});
