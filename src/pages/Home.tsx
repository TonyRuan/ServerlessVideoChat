import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Mic, MicOff, VideoOff, Laptop, Link2, QrCode, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { SettingsMenu, type VideoFitMode } from '../components/SettingsMenu';
import { useMediaStream } from '../hooks/useMediaStream';
import { buildCallSessionHash, createCallSessionId, parseInviteInput } from '../lib/callSession';
import { BUILD_INFO } from '../lib/buildInfo';
import {
  createPairingSecret,
  loadOrCreateDeviceIdentity,
  loadPairedDevices,
  removePairedDevice,
  savePairedDevice,
  type PairedDeviceSession,
} from '../lib/devicePairing';
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
  const [deviceIdentity] = useState(loadOrCreateDeviceIdentity);
  const [pairedDevices, setPairedDevices] = useState(loadPairedDevices);
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

  const handleCreateDevicePairing = () => {
    const sessionId = createCallSessionId();
    const pairingSecret = createPairingSecret();
    const now = Date.now();
    const device: PairedDeviceSession = {
      sessionId,
      pairingSecret,
      role: 'host',
      localPeerId: deviceIdentity.peerId,
      remoteName: deviceIdentity.name === '我的手机' ? '我的电脑' : '我的手机',
      createdAt: now,
      lastOpenedAt: now,
    };
    savePairedDevice(device);
    setPairedDevices(loadPairedDevices());
    navigate(`/call${buildCallSessionHash({
      sessionId,
      role: 'host',
      mode: 'device',
      pairingSecret,
      mediaDefaults: { audioEnabled: false, videoEnabled: false },
    })}`);
  };

  const openPairedDevice = (device: PairedDeviceSession) => {
    const updated = { ...device, lastOpenedAt: Date.now() };
    savePairedDevice(updated);
    const path = device.remotePeerId ? `/call/${device.remotePeerId}` : '/call';
    navigate(`${path}${buildCallSessionHash({
      sessionId: device.sessionId,
      role: device.role,
      ...(device.remotePeerId ? { peerId: device.remotePeerId } : {}),
      mode: 'device',
      pairingSecret: device.pairingSecret,
      mediaDefaults: { audioEnabled: false, videoEnabled: false },
    })}`);
  };

  const handleStartPreview = () => {
    void initializeStream(currentQuality, {
      audioEnabled: isAudioEnabled,
      videoEnabled: isVideoEnabled,
    });
  };

  const joinFromInvite = (input: string) => {
    const invite = parseInviteInput(input);
    if (!invite) {
      setJoinError('请输入完整、有效的会议或设备配对链接');
      return;
    }

    setJoinError('');
    if (invite.mode === 'device') {
      if (!invite.pairingSecret) {
        setJoinError('设备配对链接缺少安全密钥');
        return;
      }
      const now = Date.now();
      savePairedDevice({
        sessionId: invite.sessionId,
        pairingSecret: invite.pairingSecret,
        role: 'guest',
        localPeerId: deviceIdentity.peerId,
        remotePeerId: invite.peerId,
        remoteName: deviceIdentity.name === '我的手机' ? '我的电脑' : '我的手机',
        createdAt: now,
        lastOpenedAt: now,
      });
      setPairedDevices(loadPairedDevices());
    }
    navigate(`/call/${invite.peerId}${buildCallSessionHash({
      sessionId: invite.sessionId,
      role: 'guest',
      ...(invite.mode ? { mode: invite.mode } : {}),
      ...(invite.pairingSecret ? { pairingSecret: invite.pairingSecret } : {}),
      mediaDefaults: invite.mediaDefaults,
    })}`);
  };

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    joinFromInvite(meetingId);
  };

  const handleScanPairingCode = async () => {
    setJoinError('');
    try {
      const {
        CapacitorBarcodeScanner,
        CapacitorBarcodeScannerCameraDirection,
        CapacitorBarcodeScannerScanOrientation,
        CapacitorBarcodeScannerTypeHint,
      } = await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
        scanInstructions: '扫描电脑上显示的设备配对二维码',
        scanButton: false,
        cancelButtonAccessibilityLabel: '取消扫描',
        torchButtonOnAccessibilityLabel: '打开闪光灯',
        torchButtonOffAccessibilityLabel: '关闭闪光灯',
      });
      const value = result.ScanResult?.trim();
      if (!value) return;
      setMeetingId(value);
      joinFromInvite(value);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : '无法扫描二维码');
    }
  };

  return (
    <div className="svc-safe-screen min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
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

        <section className="rounded-2xl border border-blue-500/25 bg-gray-800/80 p-4 shadow-xl" aria-labelledby="my-devices-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="my-devices-title" className="flex items-center gap-2 text-lg font-semibold text-white">
                <Link2 className="h-5 w-5 text-blue-400" />
                我的设备
              </h2>
              <p className="mt-1 text-sm text-gray-400">配对一次，以后直接聊天和传文件</p>
            </div>
            <Button type="button" size="sm" onClick={handleCreateDevicePairing}>
              配对新设备
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {pairedDevices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-600 bg-gray-900/50 px-4 py-5 text-center">
                <Smartphone className="mx-auto h-7 w-7 text-gray-500" />
                <p className="mt-2 text-sm text-gray-300">还没有已配对设备</p>
                <p className="mt-1 text-xs text-gray-500">电脑创建二维码，手机粘贴或扫描配对链接</p>
              </div>
            ) : pairedDevices.map((device) => (
              <div key={device.sessionId} className="flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300">
                  {device.remoteName.includes('电脑') ? <Laptop className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
                </div>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openPairedDevice(device)}>
                  <span className="block truncate text-sm font-medium text-white">{device.remoteName}</span>
                  <span className="block text-xs text-gray-500">
                    {device.remotePeerId ? '已配对 · 打开后自动连接' : '等待另一台设备完成配对'}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-gray-400 hover:bg-gray-800 hover:text-red-300"
                  aria-label={`取消配对 ${device.remoteName}`}
                  onClick={() => {
                    removePairedDevice(device.sessionId);
                    setPairedDevices(loadPairedDevices());
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </section>

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
              <span className="bg-gray-900 px-2 text-gray-500">临时会议或设备配对链接</span>
            </div>
          </div>

          <form onSubmit={handleJoinMeeting} className="space-y-2">
            <div className="flex gap-2">
            <Input
              placeholder="粘贴会议或设备配对链接"
              aria-label="会议或设备配对链接"
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
            <Button
              type="button"
              variant="ghost"
              className="w-full text-sm text-blue-300 hover:bg-gray-800 hover:text-blue-200"
              onClick={() => void handleScanPairingCode()}
            >
              <QrCode className="mr-2 h-4 w-4" />
              扫描设备配对二维码
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
