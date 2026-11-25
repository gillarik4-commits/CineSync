import { useEffect } from 'react';

/**
 * Keeps --app-h equal to the visible height, which shrinks when a phone's
 * on-screen keyboard opens, so the chat box and messages stay above it.
 * (iOS Safari doesn't resize the page for the keyboard, it only scrolls it.)
 */
export function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      // iOS scrolls the whole page to show the focused field; undo that.
      if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--app-h');
    };
  }, []);
}
