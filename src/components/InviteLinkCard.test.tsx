import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InviteLinkCard } from './InviteLinkCard';

describe('InviteLinkCard', () => {
  it('renders the invite link with a matching QR code section', () => {
    const inviteLink = 'https://chat.example.com/call/host-peer#session=session-1&role=guest';
    const markup = renderToStaticMarkup(
      <InviteLinkCard inviteLink={inviteLink} copied={false} onCopy={() => undefined} />
    );

    expect(markup).toContain('分享此链接邀请他人');
    expect(markup).toContain('手机扫码加入');
    expect(markup).toContain('会议邀请二维码');
    expect(markup).toContain(inviteLink.replace(/&/g, '&amp;'));
    expect(markup).toContain('<svg');
  });
});
