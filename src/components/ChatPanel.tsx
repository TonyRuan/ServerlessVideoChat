import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, File as FileIcon, LockKeyhole, Paperclip, Send, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../lib/utils';
import { useChatStore } from '../stores/chatStore';
import {
  MAX_CHAT_ATTACHMENT_NAME_CHARS,
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_IMAGE_BYTES,
  type ChatImageAttachment,
  type ChatMessage,
} from '../lib/chatStorage';
import {
  formatFileTransferBytes,
  getFileTransferLimitLabel,
  getMemoryFileFallbackLimitLabel,
} from '../lib/fileTransferLimits';
import {
  formatFileTransferSpeed,
  formatFileTransferTimeRemaining,
} from '../lib/fileTransferStats';
import {
  getFileFromDataTransfer,
  getFileFromFiles,
  getImageFileFromClipboardItems,
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
  isPersistent?: boolean;
  peerLabel?: string;
  onClose: () => void;
  onSend: (input: { text?: string; image?: ChatImageAttachment; file?: File }) => Promise<void>;
  onAcceptFileTransfer: (messageId: string) => Promise<void>;
  onDeclineFileTransfer: (messageId: string) => Promise<void>;
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

const getFallbackFileName = (file: File) => file.name || 'attachment';

const formatAttachmentSize = (bytes: number) => {
  return formatFileTransferBytes(bytes);
};

const hasDraggedFiles = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types).includes('Files');

const readImageAttachment = (file: File): Promise<ChatImageAttachment> => {
  return new Promise((resolve, reject) => {
    if (!isAcceptedChatImageType(file.type)) {
      reject(new Error('仅支持 JPG、PNG、WebP 或 GIF 图片'));
      return;
    }

    if (file.size <= 0) {
      reject(new Error('图片不能为空'));
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

const validateFileForTransfer = (file: File) => {
  const fileName = getFallbackFileName(file);

  if (fileName.length > MAX_CHAT_ATTACHMENT_NAME_CHARS) {
    throw new Error(`文件名不能超过 ${MAX_CHAT_ATTACHMENT_NAME_CHARS} 个字符`);
  }

  if (file.size <= 0) {
    throw new Error('文件不能为空');
  }

  if (file.size > MAX_CHAT_FILE_BYTES) {
    throw new Error(`文件不能超过 ${getFileTransferLimitLabel()}`);
  }
};

const getFileTransferLabel = (message: ChatMessage) => {
  const transfer = message.fileTransfer;
  if (!transfer || !message.file) return null;

  const total = message.file.size > 0 ? message.file.size : 1;
  const percent = Math.min(100, Math.round((transfer.bytesTransferred / total) * 100));

  if (transfer.status === 'waiting') return '等待对方接受';
  if (transfer.status === 'offered') return Capacitor.isNativePlatform()
    ? '等待你确认接收；接受后保存到 Documents/SVC'
    : `等待你确认接收；不支持直接保存时最多 ${getMemoryFileFallbackLimitLabel()}`;
  if (transfer.status === 'transferring') return `传输中 ${percent}%`;
  if (transfer.status === 'ready') return '已接收，可下载';
  if (transfer.status === 'saved') return transfer.savedPath
    ? `已保存到 ${transfer.savedPath}`
    : '已保存到磁盘';
  if (transfer.status === 'sent') return '已发送';
  if (transfer.status === 'rejected') return '已拒绝';
  if (transfer.status === 'failed') return transfer.error || '传输失败';
  return null;
};

const getFileTransferStatsLabel = (message: ChatMessage) => {
  const transfer = message.fileTransfer;
  if (!transfer || !message.file || transfer.status !== 'transferring' || !transfer.bytesPerSecond) return null;

  const remainingBytes = Math.max(0, message.file.size - transfer.bytesTransferred);
  const remainingSeconds = remainingBytes / transfer.bytesPerSecond;
  return `速度 ${formatFileTransferSpeed(transfer.bytesPerSecond)} · 剩余 ${formatFileTransferTimeRemaining(remainingSeconds)}`;
};

export function ChatPanel({
  isOpen,
  isConnected,
  isSecure,
  connectionIssue,
  isPersistent = false,
  peerLabel,
  onClose,
  onSend,
  onAcceptFileTransfer,
  onDeclineFileTransfer,
}: ChatPanelProps) {
  const messages = useChatStore((state) => state.messages);
  const draftText = useChatStore((state) => state.draftText);
  const setDraftText = useChatStore((state) => state.setDraftText);
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<ChatImageAttachment | null>(null);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [panelPosition, setPanelPosition] = useState<ChatPanelPosition | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_MIN_WIDTH : false
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const dragOffsetRef = useRef<ChatPanelPosition | null>(null);
  const dragPositionRef = useRef<ChatPanelPosition | null>(null);
  const fileDragDepthRef = useRef(0);

  const hasSendableContent = Boolean(draftText.trim() || selectedImage || selectedFile);
  const canQueueOffline = isPersistent && !selectedFile;
  const canSend = !isSending && hasSendableContent && ((isConnected && isSecure) || canQueueOffline);

  const restorePreviousFocus = useCallback(() => {
    const previouslyFocusedElement = previouslyFocusedElementRef.current;
    previouslyFocusedElementRef.current = null;
    if (previouslyFocusedElement?.isConnected) {
      previouslyFocusedElement.focus();
    }
  }, []);

  const handleClose = useCallback(() => {
    restorePreviousFocus();
    onClose();
  }, [onClose, restorePreviousFocus]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined' || typeof window === 'undefined') return;

    const activeElement = document.activeElement;
    previouslyFocusedElementRef.current = activeElement instanceof window.HTMLElement ? activeElement : null;
    if (!isPersistent) textareaRef.current?.focus();

    return restorePreviousFocus;
  }, [isOpen, isPersistent, restorePreviousFocus]);

  useEffect(() => {
    if (isOpen) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [isOpen, messages.length]);

  useEffect(() => {
    if (!isOpen) {
      setPreviewImage(null);
      setIsFileDragActive(false);
      fileDragDepthRef.current = 0;
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

  const handlePickAttachment = async (file: File | undefined) => {
    if (!file) return;
    setError('');

    try {
      if (isAcceptedChatImageType(file.type)) {
        const image = await readImageAttachment(file);
        setSelectedImage(image);
        setSelectedFile(null);
      } else {
        if (isPersistent && (!isConnected || !isSecure)) {
          throw new Error('文件需要双方在线并建立加密连接后发送');
        }
        validateFileForTransfer(file);
        setSelectedFile(file);
        setSelectedImage(null);
      }
    } catch (err) {
      setSelectedImage(null);
      setSelectedFile(null);
      setError(err instanceof Error ? err.message : '文件读取失败');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file =
      getImageFileFromClipboardItems(event.clipboardData.items) ??
      getFileFromFiles(event.clipboardData.files);

    if (!file) return;

    event.preventDefault();
    await handlePickAttachment(file);
  };

  const clearFileDragState = () => {
    fileDragDepthRef.current = 0;
    setIsFileDragActive(false);
  };

  const handleFileDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    fileDragDepthRef.current += 1;
    setIsFileDragActive(true);
  };

  const handleFileDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsFileDragActive(true);
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    fileDragDepthRef.current -= 1;
    if (fileDragDepthRef.current <= 0) {
      clearFileDragState();
    }
  };

  const handleFileDrop = async (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;

    event.preventDefault();
    const file = getFileFromDataTransfer(event.dataTransfer);
    clearFileDragState();

    if (!file) {
      setSelectedImage(null);
      setSelectedFile(null);
      setError('请选择要发送的文件');
      return;
    }

    await handlePickAttachment(file);
  };

  const handleSend = async () => {
    if (!canSend) return;

    setIsSending(true);
    setError('');
    try {
      await onSend({
        text: draftText,
        image: selectedImage ?? undefined,
        file: selectedFile ?? undefined,
      });
      setSelectedImage(null);
      setSelectedFile(null);
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-panel-title"
        style={panelStyle}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !previewImage) {
            handleClose();
          }
        }}
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={(event) => void handleFileDrop(event)}
        className={cn(
          'absolute inset-x-4 bottom-24 z-40 h-[62dvh] overflow-hidden rounded-xl border border-gray-700 bg-gray-900/95 text-white shadow-2xl backdrop-blur-md md:inset-x-auto md:right-4 md:top-36 md:bottom-28 md:h-auto md:w-[360px]',
          useCustomPosition && 'md:bottom-auto md:right-auto',
          isDragging && 'select-none'
        )}
      >
        {isFileDragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-gray-950/75 p-4 text-center backdrop-blur-sm">
            <div className="rounded-lg border border-blue-400/60 bg-gray-900/95 px-5 py-4 shadow-xl">
              <Paperclip className="mx-auto h-7 w-7 text-blue-300" />
              <p className="mt-2 text-sm font-semibold text-white">松开发送文件</p>
              <p className="mt-1 text-xs text-gray-400">图片可预览，其他文件以下载方式接收，最大 {getFileTransferLimitLabel()}</p>
            </div>
          </div>
        )}
        <div className="flex h-full min-h-0 flex-col">
        <header
          className="flex items-center justify-between border-b border-gray-700 px-4 py-3 md:cursor-move md:touch-none"
          onPointerDown={handleDragStart}
        >
          <div>
            <h2 id="chat-panel-title" className="text-sm font-semibold">
              {isPersistent ? `与 ${peerLabel ?? '已配对设备'} 的会话` : '聊天'}
            </h2>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400">
              <LockKeyhole className={cn('h-3.5 w-3.5', isSecure ? 'text-green-400' : 'text-amber-400')} />
              {connectionIssue
                ? '网络直连失败'
                : isSecure
                  ? (isPersistent ? '在线 · 已认证加密直连' : '加密通道已就绪')
                  : isConnected
                    ? '正在建立加密通道'
                    : isPersistent
                      ? '离线 · 文字和图片将在重连后发送'
                      : '等待聊天连接'}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-gray-300 hover:bg-gray-800"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleClose}
            aria-label="关闭聊天"
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
                    {message.file && (
                      message.file.dataUrl || message.file.objectUrl ? (
                        <a
                          href={message.file.dataUrl ?? message.file.objectUrl}
                          download={message.file.name}
                          className={cn(
                            'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                            message.text && 'mt-2',
                            isMine
                              ? 'border-blue-300/40 bg-blue-500/30 text-white hover:bg-blue-500/40'
                              : 'border-gray-700 bg-gray-900/70 text-gray-100 hover:bg-gray-900'
                          )}
                          title={`下载 ${message.file.name}`}
                        >
                          <FileIcon className="h-5 w-5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{message.file.name}</span>
                            <span className={cn('block text-[11px]', isMine ? 'text-blue-100' : 'text-gray-500')}>
                              {formatAttachmentSize(message.file.size)}
                            </span>
                            {getFileTransferLabel(message) && (
                              <span className={cn('mt-1 block text-[11px]', isMine ? 'text-blue-100' : 'text-gray-400')}>
                                {getFileTransferLabel(message)}
                              </span>
                            )}
                          </span>
                          <Download className="h-4 w-4 shrink-0" />
                        </a>
                      ) : (
                        <div className={cn(
                          'rounded-lg border px-2.5 py-2 text-left',
                          message.text && 'mt-2',
                          isMine ? 'border-blue-300/40 bg-blue-500/30' : 'border-gray-700 bg-gray-900/70'
                        )}>
                          <div className="flex min-w-0 items-center gap-2">
                            <FileIcon className="h-5 w-5 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{message.file.name}</span>
                              <span className={cn('block text-[11px]', isMine ? 'text-blue-100' : 'text-gray-500')}>
                                {formatAttachmentSize(message.file.size)}
                              </span>
                            </span>
                          </div>
                          {getFileTransferLabel(message) && (
                            <p className={cn('mt-2 text-[11px]', isMine ? 'text-blue-100' : 'text-gray-400')}>
                              {getFileTransferLabel(message)}
                            </p>
                          )}
                          {getFileTransferStatsLabel(message) && (
                            <p className={cn('mt-1 text-[11px]', isMine ? 'text-blue-100' : 'text-gray-500')}>
                              {getFileTransferStatsLabel(message)}
                            </p>
                          )}
                          {message.fileTransfer?.status === 'offered' && !isMine && (
                            <div className="mt-2 flex gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                className="h-7 rounded-md px-2 text-xs"
                                onClick={() => {
                                  void onAcceptFileTransfer(message.id).catch((err) => {
                                    setError(err instanceof Error ? err.message : '无法接收文件');
                                  });
                                }}
                              >
                                接受
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-md px-2 text-xs text-gray-300 hover:bg-gray-800"
                                onClick={() => {
                                  void onDeclineFileTransfer(message.id).catch((err) => {
                                    setError(err instanceof Error ? err.message : '无法拒绝文件');
                                  });
                                }}
                              >
                                拒绝
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    )}
                    <div className={cn('mt-1 text-[10px]', isMine ? 'text-blue-100' : 'text-gray-500')}>
                      {formatTime(message.createdAt)}
                      {isMine && message.status !== 'sent'
                        ? ` · ${message.status === 'failed' ? '发送失败' : isPersistent && !isSecure ? '待发送' : '发送中'}`
                        : ''}
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
                <p className="text-[11px] text-gray-500">{formatAttachmentSize(selectedImage.size)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-gray-300"
                onClick={() => setSelectedImage(null)}
                aria-label="移除待发图片"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {selectedFile && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 p-2">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-900 text-gray-300">
                <FileIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-gray-200">{selectedFile.name}</p>
                <p className="text-[11px] text-gray-500">{formatAttachmentSize(selectedFile.size)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-gray-300"
                onClick={() => setSelectedFile(null)}
                aria-label="移除待发文件"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {(connectionIssue || error) && <p className="mb-2 text-xs text-amber-300">{connectionIssue || error}</p>}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(event) => void handlePickAttachment(event.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 rounded-full bg-gray-800 text-gray-100 hover:bg-gray-700"
              onClick={() => fileInputRef.current?.click()}
              title={isPersistent && (!isConnected || !isSecure) ? '离线时可选择图片；其他文件需要双方在线' : '选择文件'}
              aria-label="选择图片或文件"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <textarea
              ref={textareaRef}
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onPaste={(event) => void handlePaste(event)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={connectionIssue
                ? (isPersistent ? '可先输入，恢复连接后自动发送' : '网络连接恢复后可发送')
                : isConnected
                  ? '输入消息'
                  : isPersistent
                    ? '输入消息，设备上线后自动发送'
                    : '聊天连接后可发送'}
              rows={1}
              className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <Button
              variant="primary"
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={() => void handleSend()}
              disabled={!canSend}
              title={!isSecure && !canQueueOffline ? '加密通道建立后可发送' : canQueueOffline && !isSecure ? '加入待发送队列' : '发送'}
              aria-label="发送消息"
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
          aria-label={`图片预览：${previewImage.name}`}
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[92vh] max-w-[94vw]" onClick={(event) => event.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 top-2 z-10 h-9 w-9 rounded-full bg-gray-900/80 text-white hover:bg-gray-800"
              onClick={() => setPreviewImage(null)}
              title="关闭"
              aria-label="关闭图片预览"
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
