import { MessageCircle, Mic, MicOff, MoreHorizontal, PhoneOff, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import type { VideoQuality } from '../hooks/useMediaStream';
import { cn } from '../lib/utils';
import { Button } from './Button';
import { SettingsMenu, type VideoFitMode } from './SettingsMenu';

interface CallControlsProps {
  visible: boolean;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isRemoteMuted: boolean;
  isChatOpen: boolean;
  isMobileMoreOpen: boolean;
  unreadCount: number;
  streamAvailable: boolean;
  currentQuality: VideoQuality;
  videoFitMode: VideoFitMode;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleRemoteAudio: () => void;
  onQualityChange: (quality: VideoQuality) => void;
  onVideoFitModeChange: (mode: VideoFitMode) => void;
  onToggleChat: () => void;
  onOpenChat: () => void;
  onToggleMobileMore: () => void;
  onEndCall: () => void;
}

const UnreadBadge = ({ count }: { count: number }) => count > 0 ? (
  <span
    aria-hidden="true"
    className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
  >
    {count > 9 ? '9+' : count}
  </span>
) : null;

export function CallControls({
  visible,
  isAudioEnabled,
  isVideoEnabled,
  isRemoteMuted,
  isChatOpen,
  isMobileMoreOpen,
  unreadCount,
  streamAvailable,
  currentQuality,
  videoFitMode,
  onToggleAudio,
  onToggleVideo,
  onToggleRemoteAudio,
  onQualityChange,
  onVideoFitModeChange,
  onToggleChat,
  onOpenChat,
  onToggleMobileMore,
  onEndCall,
}: CallControlsProps) {
  const hiddenProps: { inert?: string } = visible ? {} : { inert: '' };
  const floatingChatVisible = visible || unreadCount > 0;
  const floatingChatHiddenProps: { inert?: string } = floatingChatVisible ? {} : { inert: '' };

  return (
    <>
      {!isChatOpen && !isMobileMoreOpen && (
        <Button
          {...floatingChatHiddenProps}
          variant={unreadCount > 0 ? 'primary' : 'secondary'}
          size="icon"
          className={cn(
            'absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] right-4 z-50 h-12 w-12 rounded-full text-white shadow-2xl ring-1 ring-gray-700 backdrop-blur-sm transition-all duration-300 ease-in-out md:hidden',
            unreadCount > 0 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-800/90 hover:bg-gray-700',
            visible || unreadCount > 0 ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
          )}
          onClick={onOpenChat}
          aria-label="打开聊天"
          aria-hidden={!floatingChatVisible}
        >
          <MessageCircle className="h-5 w-5 text-white" />
          <UnreadBadge count={unreadCount} />
        </Button>
      )}

      <div
        {...hiddenProps}
        aria-hidden={!visible}
        className={cn(
          'absolute bottom-8 left-1/2 z-50 hidden -translate-x-1/2 items-center gap-6 rounded-full border border-gray-700 bg-gray-800/90 px-8 py-4 shadow-2xl backdrop-blur-sm transition-all duration-300 ease-in-out md:flex',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0 pointer-events-none'
        )}
      >
        <Button
          variant={isAudioEnabled ? 'secondary' : 'danger'}
          size="icon"
          className="h-14 w-14 rounded-full"
          onClick={onToggleAudio}
          aria-label={isAudioEnabled ? '关闭麦克风' : '开启麦克风'}
          aria-pressed={isAudioEnabled}
        >
          {isAudioEnabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </Button>

        <Button
          variant="secondary"
          size="icon"
          className="h-14 w-14 rounded-full"
          onClick={onToggleRemoteAudio}
          aria-label={isRemoteMuted ? '开启对方声音' : '静音对方声音'}
          aria-pressed={!isRemoteMuted}
        >
          {isRemoteMuted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
        </Button>

        <Button
          variant={isVideoEnabled ? 'secondary' : 'danger'}
          size="icon"
          className={cn('h-12 w-12 rounded-full', isVideoEnabled && 'bg-gray-700 hover:bg-gray-600')}
          onClick={onToggleVideo}
          aria-label={isVideoEnabled ? '关闭摄像头' : '开启摄像头'}
          aria-pressed={isVideoEnabled}
        >
          {isVideoEnabled ? <Video className="h-5 w-5 text-white" /> : <VideoOff className="h-5 w-5 text-white" />}
        </Button>

        <SettingsMenu
          currentQuality={currentQuality}
          onQualityChange={onQualityChange}
          videoFitMode={videoFitMode}
          onVideoFitModeChange={onVideoFitModeChange}
          disabled={!streamAvailable}
        />

        <Button
          variant={isChatOpen ? 'primary' : 'secondary'}
          size="icon"
          className={cn(
            'relative h-12 w-12 rounded-full',
            isChatOpen ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
          )}
          onClick={onToggleChat}
          aria-label={isChatOpen ? '关闭聊天' : '打开聊天'}
          aria-pressed={isChatOpen}
        >
          <MessageCircle className="h-5 w-5 text-white" />
          <UnreadBadge count={unreadCount} />
        </Button>

        <Button
          variant="danger"
          size="icon"
          className="h-12 w-12 rounded-full hover:bg-red-700"
          onClick={onEndCall}
          aria-label="结束通话"
        >
          <PhoneOff className="h-5 w-5 text-white" />
        </Button>
      </div>

      <div
        {...hiddenProps}
        aria-hidden={!visible}
        className={cn(
          'absolute bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-gray-700 bg-gray-800/90 px-3 py-3 shadow-2xl backdrop-blur-sm transition-all duration-300 ease-in-out md:hidden',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0 pointer-events-none'
        )}
      >
        <Button
          variant={isAudioEnabled ? 'secondary' : 'danger'}
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={onToggleAudio}
          aria-label={isAudioEnabled ? '关闭麦克风' : '开启麦克风'}
          aria-pressed={isAudioEnabled}
        >
          {isAudioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </Button>

        <Button
          variant={isVideoEnabled ? 'secondary' : 'danger'}
          size="icon"
          className={cn('h-12 w-12 rounded-full', isVideoEnabled && 'bg-gray-700 hover:bg-gray-600')}
          onClick={onToggleVideo}
          aria-label={isVideoEnabled ? '关闭摄像头' : '开启摄像头'}
          aria-pressed={isVideoEnabled}
        >
          {isVideoEnabled ? <Video className="h-5 w-5 text-white" /> : <VideoOff className="h-5 w-5 text-white" />}
        </Button>

        <Button
          variant={isMobileMoreOpen ? 'primary' : 'secondary'}
          size="icon"
          className={cn(
            'h-12 w-12 rounded-full',
            isMobileMoreOpen ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
          )}
          onClick={onToggleMobileMore}
          aria-label="更多选项"
          aria-pressed={isMobileMoreOpen}
        >
          <MoreHorizontal className="h-5 w-5 text-white" />
        </Button>

        <Button
          variant="danger"
          size="icon"
          className="h-12 w-12 rounded-full hover:bg-red-700"
          onClick={onEndCall}
          aria-label="结束通话"
        >
          <PhoneOff className="h-5 w-5 text-white" />
        </Button>
      </div>
    </>
  );
}
