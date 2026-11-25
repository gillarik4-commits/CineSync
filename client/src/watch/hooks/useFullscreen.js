import { useCallback, useEffect, useState } from 'react';

/** Tracks document fullscreen and toggles it for `targetRef` (falls back to native video fullscreen on iOS). */
export function useFullscreen(targetRef, videoRef) {
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const el = targetRef.current;
    if (el?.requestFullscreen && document.fullscreenEnabled) {
      el.requestFullscreen().catch(() => {});
    } else {
      // iPhone Safari can only fullscreen the <video> itself.
      videoRef?.current?.webkitEnterFullscreen?.();
    }
  }, [targetRef, videoRef]);

  return [isFullscreen, toggle];
}
