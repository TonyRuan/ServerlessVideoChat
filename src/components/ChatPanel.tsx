import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LockKeyhole, Send, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../lib/utils';
import { useChatStore } from '../stores/chatStore';
import { MAX_CHAT_IMAGE_BYTES, type ChatImageAttachment } from '../lib/chatStorage';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface ChatPanelProps {
  isOpen: boolean;
  isConnected: boolean;
  isSecure: boolean;
  onClose: () => void;
  onSend: (input: { text?: string; image?: ChatImageAttachment }) => Promise<void>;
}

const formatTime = (timestamp: number) => {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
};

const readImageAttachment = (file: File): Promise<ChatImageAttachment> => {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      reject(new Error('仅支持 JPG、PNG 或 WebP 图片'));
      return;
    }

    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      reject(new Error(`图片不能超过 ${Math.floor(MAX_CHAT_IMAGE_BYTES / 1024)}KB`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('图片读取失败'));
        return;
      }

      resolve({
        dataUrl: reader.result,
        mimeType: file.type,
        name: file.name,
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
};

export function ChatPanel({ isOpen, isConnected, isSecure, onClose, onSend }: ChatPanelProps) {
  const messages = useChatStore((state) => state.messages);
  const draftText = useChatStore((state) => state.draftText);
  const setDraftText = useChatStore((state) => state.setDraftText);
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment | null>(null);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const canSend = isConnected && isSecure && !isSending && Boolean(draftText.trim() || selectedImage);

  useEffect(() => {
    if (isOpen) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [isOpen, messages.length]);

  if (!isOpen) return null;

  const handlePickImage = async (file: File | undefined) => {
    if (!file) return;
    setError('');

    try {
      const image = await readImageAttachment(file);
      setSelectedImage(image);
    } catch (err) {
      setSelectedImage(null);
      setError(err instanceof Error ? err.message : '图片读取失败');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSend = async () => {
    if (!canSend) return;

    setIsSending(true);
    setError('');
    try {
      await onSend({
        text: draftText,
        image: selectedImage ?? undefined,
      });
      setSelectedImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="absolute inset-x-4 bottom-24 z-40 h-[62dvh] overflow-hidden rounded-xl border border-gray-700 bg-gray-900/95 text-white shadow-2xl backdrop-blur-md md:inset-x-auto md:right-4 md:top-36 md:bottom-28 md:h-auto md:w-[360px]">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">聊天</h2>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400">
              <LockKeyhole className={cn('h-3.5 w-3.5', isSecure ? 'text-green-400' : 'text-amber-400')} />
              {isSecure ? '加密通道已就绪' : isConnected ? '正在建立加密通道' : '等待聊天连接'}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-gray-300 hover:bg-gray-800" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
              还没有聊天记录
            </div>
          ) : (
            messages.map((message) => {
              const isMine = message.direction === 'out';
              return (
                <div key={message.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[82%] rounded-xl px-3 py-2 text-sm shadow',
                      isMine ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100'
                    )}
                  >
                    {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
                    {message.image && (
                      <img
                        src={message.image.dataUrl}
                        alt={message.image.name}
                        className={cn('max-h-44 rounded-lg object-contain', message.text && 'mt-2')}
                      />
                    )}
                    <div className={cn('mt-1 text-[10px]', isMine ? 'text-blue-100' : 'text-gray-500')}>
                      {formatTime(message.createdAt)}
                      {isMine && message.status !== 'sent' ? ` · ${message.status === 'failed' ? '失败' : '发送中'}` : ''}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="border-t border-gray-700 p-3">
          {selectedImage && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 p-2">
              <img src={selectedImage.dataUrl} alt={selectedImage.name} className="h-12 w-12 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-gray-200">{selectedImage.name}</p>
                <p className="text-[11px] text-gray-500">{Math.ceil(selectedImage.size / 1024)} KB</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-gray-300" onClick={() => setSelectedImage(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {error && <p className="mb-2 text-xs text-amber-300">{error}</p>}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="hidden"
              onChange={(event) => void handlePickImage(event.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 rounded-full bg-gray-800 text-gray-100 hover:bg-gray-700"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-5 w-5" />
            </Button>
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={isConnected ? '输入消息' : '聊天连接后可发送'}
              rows={1}
              className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <Button
              variant="primary"
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={() => void handleSend()}
              disabled={!canSend}
              title={!isSecure ? '加密通道建立后可发送' : '发送'}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}
