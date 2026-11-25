import { useEffect, useRef, useState } from 'react';

const W = 48;
const H = 27;

/**
 * Samples the playing video into a tiny canvas a few times a second; CSS blurs
 * and scales it up behind the player so the movie's colours spill softly into
 * the room. Cheap: a 48×27 draw every ~125ms.
 */
export default function AmbientGlow({ videoRef, enabled }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !v || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let timer = 0;

    const draw = () => {
      if (v.readyState < 2 || document.hidden) return;
      try {
        ctx.drawImage(v, 0, 0, W, H);
        setReady(true);
      } catch {
        /* e.g. a cross-origin source; just skip the glow */
      }
    };
    const loop = () => {
      draw();
      timer = window.setTimeout(loop, v.paused ? 1000 : 125);
    };
    const onChange = () => draw();

    v.addEventListener('seeked', onChange);
    v.addEventListener('loadeddata', onChange);
    loop();
    return () => {
      window.clearTimeout(timer);
      v.removeEventListener('seeked', onChange);
      v.removeEventListener('loadeddata', onChange);
    };
  }, [videoRef, enabled]);

  return (
    <div className={`glow${enabled && ready ? ' is-on' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} width={W} height={H} className="glow-canvas" />
      <div className="glow-vignette" />
    </div>
  );
}
