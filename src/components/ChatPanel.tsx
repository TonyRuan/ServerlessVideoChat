import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ImagePlus, LockKeyhole, Send, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../lib/utils';
import { useChatStore } from '../stores/chatStore';
import { MAX_CHAT_IMAGE_BYTES, type ChatImageAttachment } from '../lib/chatStorage';
import {
  ACCEPTED_CHAT_IMAGE_TYPES,
  getImageFileFromClipboardItems,
  getImageFileFromDataTransfer,
  getImageFileFromFiles,
  isAcceptedChatImageType,
} from '../lib/chatAttachments';
import {
  clampChatPanelPosition,
  createChatPanelPositionStyle,
  loadChatPanelPosition,
  saveChatPanelPosition,
  type ChatPanelPosition,
} from '../lib/chatPanelPosition';

const DESKTOP_MIN_WIDTH = 768;
const BYTES_PER_MIB = 1024 * 1024;
const MAX_CHAT_IMAGE_SIZE_MB = Math.floor(MAX_CHAT_IMAGE_BYTES / BYTES_PER_MIB);

interface ChatPanelProps {
  isOpen: boolean;
  isConnected: boolean;
  isSecure: boolean;
  connectionIssue?: string | null;
  onClose: () => void;
  onSend: (input: { text?: string; image?: ChatImageAttachment }) => Promise<void>;
}

const formatTime = (timestamp: number) => {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
};

const getFallbackImageName = (file: File) => {
  if (file.name) return file.name;
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.replace('image/', '') || 'png';
  return `clipboard-image.${extension}`;
};

const formatImageSize = (bytes: number) => {
  if (bytes >= BYTES_PER_MIB) {
    return `${(bytes / BYTES_PER_MIB).toFixed(bytes >= 10 * BYTES_PER_MIB ? 0 : 1)} MB`;
  }

  return `${Math.ceil(bytes / 1024)} KB`;
};

const hasDraggedFiles = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types).includes('Files');

const readImageAttachment = (file: File): Promise<ChatImageAttachment> => {
  return new Promise((resolve, reject) => {
    if (!isAcceptedChatImageType(file.type)) {
      reject(new Error('仅支持 JPG、PNG、WebP 或 GIF 图片'));
      return;
    }

    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      reject(new Error(`图片不能超过 ${MAX_CHAT_IMAGE_SIZE_MB}MB`));
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
        name: getFallbackImageName(file),
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
};

export function ChatPanel({ isOpen, isConnected, isSecure, connectionIssue, onClose, onSend }: ChatPanelProps) {
  const messages = useChatStore((state) => state.messages);
  const draftText = useChatStore((state) => state.draftText);
  const setDraftText = useChatStore((state) => state.setDraftText);
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment | null>(null);
  const [previewImage, setPreviewImage] = useState<ChatImageAttachment | null>(null);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [panelPosition, setPanelPosition] = useState<ChatPanelPosition | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_MIN_WIDTH : false
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const dragOffsetRef = useRef<ChatPanelPosition | null>(null);
  const dragPositionRef = useRef<ChatPanelPosition | null>(null);
  const imageDragDepthRef = useRef(0);

  const canSend = isConnected && isSecure && !isSending && Boolean(draftText.trim() || selectedImage);

  useEffect(() => {
    if (isOpen) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [isOpen, messages.length]);

  useEffect(() => {
    if (!isOpen) {
      setPreviewImage(null);
      setIsImageDragActive(false);
      imageDragDepthRef.current = 0;
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateDesktopState = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    };

    updateDesktopState();
    window.addEventListener('resize', updateDesktopState);
    return () => window.removeEventListener('resize', updateDesktopState);
  }, []);

  useEffect(() => {
    if (!isOpen || !isDesktop || !sectionRef.current) return;

    const savedPosition = loadChatPanelPosition();
    if (!savedPosition) return;

    const rect = sectionRef.current.getBoundingClientRect();
    setPanelHeight(rect.height);
    setPanelPosition(
      clampChatPanelPosition(
        savedPosition,
        { width: window.innerWidth, height: window.innerHeight },
        { width: rect.width, height: rect.height }
      )
    );
  }, [isDesktop, isOpen]);

  useEffect(() => {
    if (!previewImage) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewImage(null);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewImage]);

  useEffect(() => {
    if (!isDragging) return;

    const movePanel = (event: PointerEvent) => {
      if (!dragOffsetRef.current || !sectionRef.current) return;

      const rect = sectionRef.current.getBoundingClientRect();
      const nextPosition = clampChatPanelPosition(
        {
          x: event.clientX - dragOffsetRef.current.x,
          y: event.clientY - dragOffsetRef.current.y,
        },
        { width: window.innerWidth, height: window.innerHeight },
        { width: rect.width, height: rect.height }
      );

      dragPositionRef.current = nextPosition;
      setPanelPosition(nextPosition);
    };

    const stopDragging = () => {
      if (dragPositionRef.current) {
        saveChatPanelPosition(dragPositionRef.current);
      }
      dragOffsetRef.current = null;
      dragPositionRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', movePanel);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    return () => {
      window.removeEventListener('pointermove', movePanel);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [isDragging]);

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!isDesktop || !sectionRef.current || event.button !== 0) return;

    const rect = sectionRef.current.getBoundingClientRect();
    const nextPosition = { x: rect.left, y: rect.top };
    setPanelHeight(rect.height);
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    dragPositionRef.current = nextPosition;
    setPanelPosition(nextPosition);
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [isDesktop]);

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

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file =
      getImageFileFromClipboardItems(event.clipboardData.items) ??
      getImageFileFromFiles(event.clipboardData.files);

    if (!file) return;

    event.preventDefault();
    await handlePickImage(file);
  };

  const clearImageDragState = () => {
    imageDragDepthRef.current = 0;
    setIsImageDragActive(false);
  };

  const handleImageDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    imageDragDepthRef.current += 1;
    setIsImageDragActive(true);
  };

  const handleImageDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsImageDragActive(true);
  };

  const handleImageDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    imageDragDepthRef.current -= 1;
    if (imageDragDepthRef.current <= 0) {
      clearImageDragState();
    }
  };

  const handleImageDrop = async (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    const file = getImageFileFromDataTransfer(event.dataTransfer);
    clearImageDragState();

    if (!file) {
      setSelectedImage(null);
      setError('仅支持 JPG、PNG、WebP 或 GIF 图片');
      return;
    }

    await handlePickImage(file);
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

  const useCustomPosition = isDesktop && panelPosition && panelHeight;
  const panelStyle: CSSProperties | undefined = useCustomPosition
    ? createChatPanelPositionStyle(panelPosition, panelHeight)
    : undefined;

  return (
    <>
      <section
        ref={sectionRef}
        style={panelStyle}
        onDragEnter={handleImageDragEnter}
        onDragOver={handleImageDragOver}
        onDragLeave={handleImageDragLeave}
        onDrop={(event) => void handleImageDrop(event)}
        className={cn(
          'absolute inset-x-4 bottom-24 z-40 h-[62dvh] overflow-hidden rounded-xl border border-gray-700 bg-gray-900/95 text-white shadow-2xl backdrop-blur-md md:inset-x-auto md:right-4 md:top-36 md:bottom-28 md:h-auto md:w-[360px]',
          useCustomPosition && 'md:bottom-auto md:right-auto',
          isDragging && 'select-none'
        )}
      >
        {isImageDragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-gray-950/75 p-4 text-center backdrop-blur-sm">
            <div className="rounded-lg border border-blue-400/60 bg-gray-900/95 px-5 py-4 shadow-xl">
              <ImagePlus className="mx-auto h-7 w-7 text-blue-300" />
              <p className="mt-2 text-sm font-semibold text-white">松开上传图片</p>
              <p className="mt-1 text-xs text-gray-400">支持 JPG、PNG、WebP、GIF，最大 {MAX_CHAT_IMAGE_SIZE_MB}MB</p>
            </div>
          </div>
        )}
        <div className="flex h-full min-h-0 flex-col">
        <header
          className="flex items-center justify-between border-b border-gray-700 px-4 py-3 md:cursor-move md:touch-none"
          onPointerDown={handleDragStart}
        >
          <div>
            <h2 className="text-sm font-semibold">聊天</h2>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400">
              <LockKeyhole className={cn('h-3.5 w-3.5', isSecure ? 'text-green-400' : 'text-amber-400')} />
              {connectionIssue ? '网络直连失败' : isSecure ? '加密通道已就绪' : isConnected ? '正在建立加密通道' : '等待聊天连接'}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-gray-300 hover:bg-gray-800"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
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
                      message.image.dataUrl ? (
                        <button
                          type="button"
                          className={cn('block overflow-hidden rounded-lg', message.text && 'mt-2')}
                          onClick={() => setPreviewImage(message.image ?? null)}
                          title="查看图片"
                        >
                          <img
                            src={message.image.dataUrl}
                            alt={message.image.name}
                            className="max-h-44 object-contain"
                          />
                        </button>
                      ) : (
                        <p className={cn('text-xs text-gray-400', message.text && 'mt-2')}>图片未保存在本地</p>
                      )
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
              <button
                type="button"
                className="h-12 w-12 overflow-hidden rounded"
                onClick={() => setPreviewImage(selectedImage)}
                title="查看图片"
              >
                <img src={selectedImage.dataUrl} alt={selectedImage.name} className="h-full w-full object-cover" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-gray-200">{selectedImage.name}</p>
                <p className="text-[11px] text-gray-500">{formatImageSize(selectedImage.size)}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-gray-300" onClick={() => setSelectedImage(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {(connectionIssue || error) && <p className="mb-2 text-xs text-amber-300">{connectionIssue || error}</p>}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_CHAT_IMAGE_TYPES.join(',')}
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
              onPaste={(event) => void handlePaste(event)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={connectionIssue ? '网络连接恢复后可发送' : isConnected ? '输入消息' : '聊天连接后可发送'}
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

      {previewImage && previewImage.dataUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[92vh] max-w-[94vw]" onClick={(event) => event.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 top-2 z-10 h-9 w-9 rounded-full bg-gray-900/80 text-white hover:bg-gray-800"
              onClick={() => setPreviewImage(null)}
              title="关闭"
            >
              <X className="h-4 w-4" />
            </Button>
            <img
              src={previewImage.dataUrl}
              alt={previewImage.name}
              className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
            />
            <p className="mt-2 text-center text-xs text-gray-300">{previewImage.name}</p>
          </div>
        </div>
      )}
    </>
  );
}
