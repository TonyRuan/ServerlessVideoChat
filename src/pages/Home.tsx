import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Mic, MicOff, VideoOff } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { SettingsMenu } from '../components/SettingsMenu';
import { useMediaStream } from '../hooks/useMediaStream';

export default function Home() {
  const navigate = useNavigate();
  const { stream, error, isAudioEnabled, isVideoEnabled, initializeStream, toggleAudio, toggleVideo, currentQuality, changeQuality } = useMediaStream();
  const [meetingId, setMeetingId] = useState('');
  const videoRef = React.useRef<HTMLVideoElement>(null);

  useEffect(() => {
    initializeStream();
  }, [initializeStream]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleCreateMeeting = () => {
    navigate('/call');
  };

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    let id = meetingId.trim();
    if (!id) return;

    // Enhanced URL parsing logic
    try {
      // 1. Try to treat input as a full URL
      const url = new URL(id.startsWith('http') ? id : `https://${id}`);
      const pathParts = url.pathname.split('/');
      // Find the segment after 'call'
      const callIndex = pathParts.findIndex(part => part === 'call');
      if (callIndex !== -1 && callIndex + 1 < pathParts.length) {
        id = pathParts[callIndex + 1];
      } else {
        // Fallback: take the last non-empty segment
        const lastSegment = pathParts.filter(p => p).pop();
        if (lastSegment) id = lastSegment;
      }
    } catch {
      // 2. If URL parsing fails, check for simple pattern match
      const match = id.match(/\/call\/([a-zA-Z0-9-]+)/);
      if (match && match[1]) {
        id = match[1];
      }
    }

    // Clean up any remaining URL artifacts if present
    if (id.includes('/')) {
        const parts = id.split('/');
        id = parts[parts.length - 1];
    }

    navigate(`/call/${id}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-blue-500 mb-2">VideoChat</h1>
          <p className="text-gray-400">Secure, peer-to-peer video calls.</p>
        </div>

        {/* Video Preview */}
        <div className="relative aspect-video bg-gray-800 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-gray-700">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center text-red-400 p-4 text-center">
              <p>Camera access denied. Please enable permissions to continue.</p>
            </div>
          ) : !stream ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
              <p>Initializing camera...</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`w-full h-full object-cover transform scale-x-[-1] ${!isVideoEnabled ? 'hidden' : ''}`}
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
              onClick={toggleAudio}
              disabled={!stream}
            >
              {isAudioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
            <Button
              variant={isVideoEnabled ? 'secondary' : 'danger'}
              size="icon"
              className="rounded-full h-12 w-12"
              onClick={toggleVideo}
              disabled={!stream}
            >
              {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Button>
            <SettingsMenu
              currentQuality={currentQuality}
              onQualityChange={changeQuality}
              disabled={!stream}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <Button 
            className="w-full h-12 text-lg" 
            onClick={handleCreateMeeting}
            disabled={!stream && !error}
          >
            <Video className="mr-2 h-5 w-5" />
            New Meeting
          </Button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-gray-900 px-2 text-gray-500">Or join with code</span>
            </div>
          </div>

          <form onSubmit={handleJoinMeeting} className="flex gap-2">
            <Input
              placeholder="Enter meeting code"
              value={meetingId}
              onChange={(e) => setMeetingId(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white focus:ring-blue-500 h-12"
            />
            <Button 
              type="submit" 
              variant="secondary" 
              className="h-12 px-6"
              disabled={!meetingId.trim() || (!stream && !error)}
            >
              Join
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
