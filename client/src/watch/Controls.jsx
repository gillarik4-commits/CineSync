import { useEffect, useRef, useState } from 'react';
import {
  Captions,
  CaptionsOff,
  Clapperboard,
  Maximize,
  MessageSquare,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useVideoState } from './hooks/useVideo';
import { formatTime } from '../shared/lib/format';

/**
 * Seek bar. The fill is driven from requestAnimationFrame straight to the DOM
 * so playback looks smooth without re-rendering React 60 times a second.
 */
function Scrubber({ videoRef, duration, buffered, onSeek, onScrubbingChange }) {
  const barRef = useRef(null);
  const fillRef = useRef(null);
  const [hover, setHover] = useState(null); // { pos, time }
  const scrubbing = useRef(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && fillRef.current && !scrubbing.current) {
        const pct = v.duration ? (v.currentTime / v.duration) * 100 : 0;
        fillRef.current.style.width = `${pct}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const posFrom = (e) => {
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e) => {
    if (!duration) return;
    scrubbing.current = true;
    onScrubbingChange?.(true);
    barRef.current.setPointerCapture(e.pointerId);
    const pos = posFrom(e);
    fillRef.current.style.width = `${pos * 100}%`;
    setHover({ pos, time: pos * duration });
  };

  const onPointerMove = (e) => {
    if (!duration) return;
    const pos = posFrom(e);
    setHover({ pos, time: pos * duration });
    if (scrubbing.current) fillRef.current.style.width = `${pos * 100}%`;
  };

  const finish = (e) => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    onScrubbingChange?.(false);
    if (barRef.current.hasPointerCapture(e.pointerId)) barRef.current.releasePointerCapture(e.pointerId);
    onSeek(posFrom(e) * duration);
    if (e.type === 'pointercancel') setHover(null);
  };

  const bufferedPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <div
      ref={barRef}
      className="scrubber"
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(videoRef.current?.currentTime || 0)}
      aria-valuetext={formatTime(videoRef.current?.currentTime || 0)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => !scrubbing.current && setHover(null)}
    >
      <div className="scrubber-track">
        <div className="scrubber-buffered" style={{ width: `${bufferedPct}%` }} />
        {hover && <div className="scrubber-hover" style={{ width: `${hover.pos * 100}%` }} />}
        <div ref={fillRef} className="scrubber-fill">
          <span className="scrubber-thumb" />
        </div>
      </div>
      {hover && (
        <div className="scrubber-tooltip mono" style={{ left: `${hover.pos * 100}%` }}>
          {formatTime(hover.time)}
        </div>
      )}
    </div>
  );
}

function VolumeControl({ volume, muted, onToggleMute, onVolume }) {
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;
  return (
    <div className="volume">
      <button type="button" className="ctrl" onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title="Mute (M)">
        <Icon size={18} />
      </button>
      <input
        className="volume-slider"
        type="range"
        min="0"
        max="1"
        step="0.02"
        value={level}
        onChange={(e) => onVolume(parseFloat(e.target.value))}
        aria-label="Volume"
        style={{ '--level': `${level * 100}%` }}
      />
    </div>
  );
}

export default function Controls({
  videoRef,
  onTogglePlay,
  onSeek,
  onSkip,
  onToggleMute,
  onVolume,
  captions,
  onToggleCaptions,
  isFullscreen,
  onToggleFullscreen,
  onToggleChat,
  onChatContextMenu,
  chatActive,
  chatUnread,
  chatMenu,
  onChangeMovie,
  onScrubbingChange
}) {
  const v = useVideoState(videoRef);
  const [showRemaining, setShowRemaining] = useState(false);

  return (
    <div className="controls" onClick={(e) => e.stopPropagation()}>
      <Scrubber
        videoRef={videoRef}
        duration={v.duration}
        buffered={v.buffered}
        onSeek={onSeek}
        onScrubbingChange={onScrubbingChange}
      />
      <div className="controls-row">
        <div className="controls-group">
          <button
            type="button"
            className="ctrl ctrl-play"
            onClick={onTogglePlay}
            aria-label={v.paused ? 'Play' : 'Pause'}
            title={v.paused ? 'Play (Space)' : 'Pause (Space)'}
          >
            {v.paused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
          </button>
          <button type="button" className="ctrl" onClick={() => onSkip(-10)} aria-label="Back 10 seconds" title="Back 10s (←)">
            <RotateCcw size={18} />
          </button>
          <button type="button" className="ctrl" onClick={() => onSkip(10)} aria-label="Forward 10 seconds" title="Forward 10s (→)">
            <RotateCw size={18} />
          </button>
          <VolumeControl volume={v.volume} muted={v.muted} onToggleMute={onToggleMute} onVolume={onVolume} />
          <button
            type="button"
            className="time mono"
            onClick={() => setShowRemaining((r) => !r)}
            title="Show remaining time"
          >
            {showRemaining ? `-${formatTime(Math.max(0, v.duration - v.time))}` : formatTime(v.time)}
            <span className="time-sep">/</span>
            <span className="time-total">{formatTime(v.duration)}</span>
          </button>
        </div>

        <div className="controls-group">
          <button
            type="button"
            className={`ctrl${captions.on ? ' is-on' : ''}`}
            onClick={onToggleCaptions}
            disabled={!captions.available}
            aria-label={captions.available ? (captions.on ? 'Hide subtitles' : 'Show subtitles') : 'No subtitles for this movie'}
            title={captions.available ? 'Subtitles (C)' : 'No subtitles for this movie'}
          >
            {captions.on ? <Captions size={18} /> : <CaptionsOff size={18} />}
          </button>
          <div className="chat-btn-wrap">
            <button
              type="button"
              className={`ctrl${chatActive ? ' is-on' : ''}`}
              onClick={onToggleChat}
              onContextMenu={onChatContextMenu}
              aria-label="Chat"
              aria-haspopup={isFullscreen ? 'menu' : undefined}
              title={isFullscreen ? 'Chat style (T)' : 'Chat (T) · right-click for fullscreen style'}
            >
              <MessageSquare size={18} />
              {chatUnread && <span className="unread-dot" aria-label="Unread messages" />}
            </button>
            {chatMenu}
          </div>
          <button type="button" className="ctrl" onClick={onChangeMovie} aria-label="Change movie" title="Change movie">
            <Clapperboard size={18} />
          </button>
          <button
            type="button"
            className="ctrl"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title="Fullscreen (F)"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
