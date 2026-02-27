import { Settings, Check } from 'lucide-react';
import { Button } from './Button';
import { VIDEO_QUALITIES, VideoQuality } from '../hooks/useMediaStream';
import { useState } from 'react';

export type VideoFitMode = 'cover' | 'contain';

interface SettingsMenuProps {
  currentQuality: VideoQuality;
  onQualityChange: (quality: VideoQuality) => void;
  videoFitMode: VideoFitMode;
  onVideoFitModeChange: (mode: VideoFitMode) => void;
  disabled?: boolean;
}

export function SettingsMenu({ 
  currentQuality, 
  onQualityChange, 
  videoFitMode,
  onVideoFitModeChange,
  disabled 
}: SettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full h-12 w-12 bg-gray-700 hover:bg-gray-600"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title="Settings"
      >
        <Settings className="h-5 w-5 text-white" />
      </Button>

      {isOpen && (
        <div className="absolute bottom-16 right-0 w-56 bg-gray-800 rounded-lg shadow-xl ring-1 ring-black ring-opacity-5 z-50 overflow-hidden">
          {/* Display Mode Section */}
          <div className="p-2 border-b border-gray-700">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-2">Display Mode</h3>
            <div className="space-y-1">
              <button
                onClick={() => {
                  onVideoFitModeChange('cover');
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between group ${
                  videoFitMode === 'cover'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span>Full Screen (Cover)</span>
                {videoFitMode === 'cover' && <Check className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  onVideoFitModeChange('contain');
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between group ${
                  videoFitMode === 'contain'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span>Fit Screen (Contain)</span>
                {videoFitMode === 'contain' && <Check className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Video Quality Section */}
          <div className="p-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-2">Video Quality</h3>
            <div className="space-y-1">
              {VIDEO_QUALITIES.map((quality) => (
                <button
                  key={quality.label}
                  onClick={() => {
                    onQualityChange(quality);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between group ${
                    currentQuality.label === quality.label
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <span>{quality.label}</span>
                  {currentQuality.label === quality.label && (
                    <Check className="h-4 w-4" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Click outside to close */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
