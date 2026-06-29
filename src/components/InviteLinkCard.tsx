import { Copy, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from './Button';

interface InviteLinkCardProps {
  inviteLink: string;
  copied: boolean;
  onCopy: () => void;
}

export function InviteLinkCard({ inviteLink, copied, onCopy }: InviteLinkCardProps) {
  return (
    <div className="mx-auto mt-8 w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-5 shadow-xl sm:p-6">
      <p className="mb-2 text-sm text-gray-400">分享此链接邀请他人</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={inviteLink}
          className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 focus:outline-none"
          aria-label="会议邀请链接"
        />
        <Button onClick={onCopy} variant="secondary" size="icon" title="复制邀请链接">
          {copied ? <Share2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mt-5 flex flex-col items-center gap-3">
        <div className="rounded-lg bg-white p-3 shadow-sm">
          <QRCodeSVG
            value={inviteLink}
            size={176}
            level="M"
            marginSize={2}
            bgColor="#ffffff"
            fgColor="#111827"
            title="会议邀请二维码"
          />
        </div>
        <p className="text-xs text-gray-400">手机扫码加入</p>
      </div>
    </div>
  );
}
