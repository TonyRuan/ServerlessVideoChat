import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Home from './Home';

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => vi.fn(),
}));

describe('Home', () => {
  it('waits for an explicit preview action before acquiring media', () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('启动设备预览');
    expect(markup.match(/<button[^>]*aria-label="关闭麦克风"[^>]*>/)?.[0]).not.toMatch(/\sdisabled(?:=|>)/);
    expect(markup.match(/<button[^>]*aria-label="关闭摄像头"[^>]*>/)?.[0]).not.toMatch(/\sdisabled(?:=|>)/);
    expect(markup).not.toContain('初始化摄像头');
  });
});
