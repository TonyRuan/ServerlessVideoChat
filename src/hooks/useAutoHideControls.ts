import { useCallback, useEffect, useRef, useState } from 'react';

const CONTROL_ACTIVITY_EVENTS = ['mousemove', 'click', 'touchstart', 'keydown'] as const;

export function useAutoHideControls(timeoutMs = 3000) {
  const [isVisible, setIsVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => {
    setIsVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsVisible(false), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    for (const eventName of CONTROL_ACTIVITY_EVENTS) {
      window.addEventListener(eventName, reveal);
    }
    reveal();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const eventName of CONTROL_ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, reveal);
      }
    };
  }, [reveal]);

  return isVisible;
}
