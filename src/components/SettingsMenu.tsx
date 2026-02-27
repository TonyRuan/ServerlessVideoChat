import { Settings, Check } from 'lucide-react';
import { Button } from './Button';
import { VIDEO_QUALITIES, VideoQuality } from '../hooks/useMediaStream';
import { useState } from 'react';

interface SettingsMenuProps {
  currentQuality: VideoQuality;
  onQualityChange: (quality: VideoQuality) => void;
  disabled?: boolean;
}

export function SettingsMenu({ currentQuality, onQualityChange, disabled }: SettingsMenuProps) {
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
        <div className="absolute bottom-16 right-0 w-48 bg-gray-800 rounded-lg shadow-xl ring-1 ring-black ring-opacity-5 z-50 overflow-hidden">
          <div className="p-2 border-b border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 px-2">Video Quality</h3>
          </div>
          <div className="p-1">
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
