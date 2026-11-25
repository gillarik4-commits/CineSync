import { useCallback, useEffect, useState } from 'react';

/**
 * Fullscreen for the whole room (video + chat).
 * Browsers with the Fullscreen API use it. iPhone Safari can only fullscreen a
 * bare <video> in Apple's own player (no chat, no overlays), so there we use a
 * "pseudo" fullscreen instead: the room fills the screen with CSS.
 * Returns [isFullscreen, toggle, isPseudo].
 */
export function useFullscreen(targetRef) {
  const [native, setNative] = useState(() => Boolean(document.fullscreenElement));
  const [pseudo, setPseudo] = useState(false);

  useEffect(() => {
    const onChange = () => setNative(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!pseudo) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPseudo(false);
    document.addEventListener('keydown', onKey);
    window.scrollTo(0, 0);
    return () => document.removeEventListener('keydown', onKey);
  }, [pseudo]);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (pseudo) {
      setPseudo(false);
      return;
    }
    const el = targetRef.current;
    if (el?.requestFullscreen && document.fullscreenEnabled) {
      el.requestFullscreen().catch(() => setPseudo(true));
    } else {
      setPseudo(true);
    }
  }, [targetRef, pseudo]);

  return [native || pseudo, toggle, pseudo];
}
