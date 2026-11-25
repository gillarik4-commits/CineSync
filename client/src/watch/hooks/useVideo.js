import { useEffect, useState } from 'react';

const EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'volumechange', 'seeked', 'emptied', 'ended'];

function bufferedEnd(v) {
  const b = v.buffered;
  if (!b || b.length === 0) return 0;
  const t = v.currentTime;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
  }
  return b.end(b.length - 1);
}

function snapshot(v) {
  return {
    paused: v.paused,
    time: v.currentTime || 0,
    duration: Number.isFinite(v.duration) ? v.duration : 0,
    buffered: bufferedEnd(v),
    volume: v.volume,
    muted: v.muted
  };
}

/** Subscribes to a <video>'s state. Use it only in components that need to re-render on time changes. */
export function useVideoState(videoRef) {
  const [state, setState] = useState({ paused: true, time: 0, duration: 0, buffered: 0, volume: 1, muted: false });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const update = () => setState(snapshot(v));
    EVENTS.forEach((e) => v.addEventListener(e, update));
    update();
    return () => EVENTS.forEach((e) => v.removeEventListener(e, update));
  }, [videoRef]);

  return state;
}

/** Just paused/playing + buffering, for components that shouldn't re-render on every timeupdate. */
export function usePlayback(videoRef) {
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onWaiting = () => setWaiting(true);
    const onReady = () => setWaiting(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    ['playing', 'canplay', 'seeked', 'pause'].forEach((e) => v.addEventListener(e, onReady));
    setPaused(v.paused);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      ['playing', 'canplay', 'seeked', 'pause'].forEach((e) => v.removeEventListener(e, onReady));
    };
  }, [videoRef]);

  return { paused, waiting };
}
