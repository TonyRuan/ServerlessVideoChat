import { Button } from './Button';

interface CallIssuePanelProps {
  title: string;
  message: string;
  detail?: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  tertiaryAction?: {
    label: string;
    onClick: () => void;
  };
}

export function CallIssuePanel({
  title,
  message,
  detail,
  primaryAction,
  secondaryAction,
  tertiaryAction,
}: CallIssuePanelProps) {
  return (
    <div className="min-h-screen bg-gray-900 px-4 text-white flex items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-800/80 p-6 text-center shadow-2xl">
        <p className="text-xl font-semibold text-red-400">{title}</p>
        <p className="mt-3 text-sm leading-6 text-gray-300">{message}</p>
        {detail ? <p className="mt-2 break-words text-xs text-gray-500">{detail}</p> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {primaryAction ? (
            <Button onClick={primaryAction.onClick}>{primaryAction.label}</Button>
          ) : null}
          {secondaryAction ? (
            <Button variant="secondary" onClick={secondaryAction.onClick}>{secondaryAction.label}</Button>
          ) : null}
          {tertiaryAction ? (
            <Button
              variant="ghost"
              className="text-gray-300 hover:bg-gray-700 hover:text-white"
              onClick={tertiaryAction.onClick}
            >
              {tertiaryAction.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
