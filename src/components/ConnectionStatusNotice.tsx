import { RefreshCw } from 'lucide-react';

interface ConnectionStatusNoticeProps {
  message: string;
  onRetry?: () => void;
}
export function ConnectionStatusNotice({ message, onRetry }: ConnectionStatusNoticeProps) {
  return (
    <div
      role="status"
      className="absolute bottom-[calc(7rem+var(--svc-safe-area-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl border border-amber-500/40 bg-gray-900/95 px-4 py-3 text-sm text-amber-100 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 text-xs font-medium text-amber-100 transition hover:bg-amber-400/10"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            立即重试
          </button>
        ) : null}
      </div>
    </div>
  );
}
