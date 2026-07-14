import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Mic, MicOff, VideoOff } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { SettingsMenu, type VideoFitMode } from '../components/SettingsMenu';
import { useMediaStream } from '../hooks/useMediaStream';
import { buildCallSessionHash, createCallSessionId, parseInviteInput } from '../lib/callSession';
import { BUILD_INFO } from '../lib/buildInfo';
import logoUrl from '../assets/serverless-video-chat-logo.png';

export default function Home() {
  const navigate = useNavigate();
  const {
    stream,
    error,
    isAudioEnabled,
    isVideoEnabled,
    isAudioPending,
    isVideoPending,
    initializeStream,
    toggleAudio,
    toggleVideo,
    currentQuality,
    changeQuality,
  } = useMediaStream();
  const [meetingId, setMeetingId] = useState('');
  const [joinError, setJoinError] = useState('');
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>('cover');
  const videoRef = React.useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleCreateMeeting = () => {
    navigate(`/call${buildCallSessionHash({
      sessionId: createCallSessionId(),
      role: 'host',
      mediaDefaults: {
        audioEnabled: isAudioEnabled,
        videoEnabled: isVideoEnabled,
      },
    })}`);
  };

  const handleStartPreview = () => {
    void initializeStream(currentQuality, {
      audioEnabled: isAudioEnabled,
      videoEnabled: isVideoEnabled,
    });
  };

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    const invite = parseInviteInput(meetingId);
    if (!invite) {
      setJoinError('请输入完整、有效的会议邀请链接');
      return;
    }

    setJoinError('');
    navigate(`/call/${invite.peerId}${buildCallSessionHash({
      sessionId: invite.sessionId,
      role: 'guest',
      mediaDefaults: invite.mediaDefaults,
    })}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className="mx-auto mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20"
          />
          <h1 className="text-4xl font-bold tracking-tight text-blue-500 mb-2">VideoChat</h1>
          <p className="text-gray-400">安全、点对点视频通话。</p>
          <p className="mt-1 text-xs text-gray-500">v{BUILD_INFO.version} · mrtr@foxmail.com</p>
        </div>

        {/* Video Preview */}
        <div className="relative aspect-video bg-gray-800 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-gray-700">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center text-red-400 p-4 text-center">
              <div className="space-y-3">
                <p>无法访问所选音视频设备。</p>
                <Button type="button" variant="secondary" onClick={handleStartPreview}>
                  重试预览
                </Button>
              </div>
            </div>
          ) : !stream ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Button type="button" variant="secondary" onClick={handleStartPreview}>
                <Video className="mr-2 h-4 w-4" />
                启动设备预览
              </Button>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`w-full h-full transition-all duration-300 ${videoFitMode === 'cover' ? 'object-cover' : 'object-contain bg-black'} transform scale-x-[-1] ${!isVideoEnabled ? 'hidden' : ''}`}
            />
          )}
          
          {!isVideoEnabled && stream && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <div className="h-20 w-20 rounded-full bg-gray-700 flex items-center justify-center">
                <VideoOff className="h-10 w-10 text-gray-500" />
              </div>
            </div>
          )}

          {/* Controls Overlay */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
            <Button
              variant={isAudioEnabled ? 'secondary' : 'danger'}
              size="icon"
              className="rounded-full h-12 w-12"
              onClick={() => void toggleAudio()}
              disabled={isAudioPending}
              aria-label={isAudioEnabled ? '关闭麦克风' : '开启麦克风'}
              aria-pressed={isAudioEnabled}
            >
              {isAudioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
            <Button
              variant={isVideoEnabled ? 'secondary' : 'danger'}
              size="icon"
              className="rounded-full h-12 w-12"
              onClick={() => void toggleVideo()}
              disabled={isVideoPending}
              aria-label={isVideoEnabled ? '关闭摄像头' : '开启摄像头'}
              aria-pressed={isVideoEnabled}
            >
              {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Button>
            <SettingsMenu
              currentQuality={currentQuality}
              onQualityChange={changeQuality}
              videoFitMode={videoFitMode}
              onVideoFitModeChange={setVideoFitMode}
              disabled={!stream}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <Button 
            className="w-full h-12 text-lg" 
            onClick={handleCreateMeeting}
          >
            <Video className="mr-2 h-5 w-5" />
            新建会议
          </Button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-gray-900 px-2 text-gray-500">或者使用邀请链接加入</span>
            </div>
          </div>

          <form onSubmit={handleJoinMeeting} className="space-y-2">
            <div className="flex gap-2">
            <Input
              placeholder="粘贴完整会议邀请链接"
              aria-label="会议邀请链接"
              value={meetingId}
              onChange={(e) => {
                setMeetingId(e.target.value);
                if (joinError) setJoinError('');
              }}
              className="min-w-0 bg-gray-800 border-gray-700 text-white focus:ring-blue-500 h-12"
            />
            <Button 
              type="submit" 
              variant="secondary" 
              className="h-12 shrink-0 whitespace-nowrap px-6"
              disabled={!meetingId.trim()}
            >
              加入
            </Button>
            </div>
            {joinError && <p className="text-sm text-red-400" role="alert">{joinError}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}
