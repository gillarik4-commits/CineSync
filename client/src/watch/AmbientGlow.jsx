import { useEffect, useRef, useState } from 'react';

const W = 32;
const H = 18;
const FRAME_MS = 33; // ~30 updates a second
const BLEND = 0.08; // how much of the new picture each update mixes in (~0.4s to settle)
const CATCH_UP_BLEND = 0.3; // after a seek or load, settle quickly instead of slowly
const CATCH_UP_FRAMES = 12;
const IDLE_FRAMES = 45; // while paused, keep blending ~1.5s, then rest

/**
 * The movie's colours, glowing softly around the player.
 *
 * Smoothness comes from blending: every frame mixes a little of the current
 * picture into a tiny canvas (an exponential moving average), so colours glide
 * instead of jumping. Cheapness comes from blurring a quarter-size layer and
 * scaling it up in CSS, rather than blurring a full-screen one.
 */
export default function AmbientGlow({ videoRef, enabled }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !v || !canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    let raf = 0;
    let last = 0;
    let catchUp = CATCH_UP_FRAMES;
    let idle = 0;
    let started = false;

    const tick = (now) => {
      raf = 0;
      if (now - last >= FRAME_MS) {
        last = now;
        if (v.readyState >= 2 && !document.hidden) {
          try {
            ctx.globalAlpha = !started ? 1 : catchUp > 0 ? CATCH_UP_BLEND : BLEND;
            ctx.drawImage(v, 0, 0, W, H);
            if (!started) {
              started = true;
              setReady(true);
            }
            if (catchUp > 0) catchUp -= 1;
          } catch {
            return; // e.g. a cross-origin source: no glow
          }
        }
        idle = v.paused ? idle + 1 : 0;
      }
      // While paused, finish settling and then stop until something changes.
      if (idle < IDLE_FRAMES) raf = requestAnimationFrame(tick);
    };

    const wake = (fast) => {
      if (fast) catchUp = CATCH_UP_FRAMES;
      idle = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => wake(false);
    const onJump = () => wake(true);

    v.addEventListener('play', onPlay);
    v.addEventListener('seeked', onJump);
    v.addEventListener('loadeddata', onJump);
    document.addEventListener('visibilitychange', onPlay);
    wake(true);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('seeked', onJump);
      v.removeEventListener('loadeddata', onJump);
      document.removeEventListener('visibilitychange', onPlay);
    };
  }, [videoRef, enabled]);

  return (
    <div className={`glow${enabled && ready ? ' is-on' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} width={W} height={H} className="glow-canvas" />
      <div className="glow-vignette" />
    </div>
  );
}
