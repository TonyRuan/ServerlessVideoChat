import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CallControls } from './CallControls';

const renderControls = (visible: boolean) => renderToStaticMarkup(
  <CallControls
    visible={visible}
    isAudioEnabled
    isVideoEnabled={false}
    isRemoteMuted
    isChatOpen={false}
    isMobileMoreOpen={false}
    unreadCount={2}
    streamAvailable
    currentQuality={{ label: '720p (HD)', width: 1280, height: 720, frameRate: 30 }}
    videoFitMode="cover"
    onToggleAudio={vi.fn()}
    onToggleVideo={vi.fn()}
    onToggleRemoteAudio={vi.fn()}
    onQualityChange={vi.fn()}
    onVideoFitModeChange={vi.fn()}
    onToggleChat={vi.fn()}
    onOpenChat={vi.fn()}
    onToggleMobileMore={vi.fn()}
    onEndCall={vi.fn()}
  />
);

describe('CallControls', () => {
  it('names icon controls and exposes their pressed state', () => {
    const html = renderControls(true);

    expect(html).toContain('aria-label="关闭麦克风"');
    expect(html).toContain('aria-label="开启摄像头"');
    expect(html).toContain('aria-label="开启对方声音"');
    expect(html).toContain('aria-label="打开聊天"');
    expect(html).toContain('aria-label="更多选项"');
    expect(html).toContain('aria-label="通话设置"');
    expect(html).toContain('aria-label="结束通话"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('removes auto-hidden controls from assistive and keyboard navigation', () => {
    const html = renderControls(false);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
  });
});
