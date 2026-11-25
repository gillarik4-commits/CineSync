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
function Scrubber({ videoRef, duration, buffered, prepared, onSeek, onScrubbingChange, disabled }) {
  const barRef = useRef(null);
  const fillRef = useRef(null);
  const [hover, setHover] = useState(null); // { pos, time }
  const scrubbing = useRef(false);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && fillRef.current && !scrubbing.current) {
        const d = durationRef.current;
        const pct = d ? Math.min(100, (v.currentTime / d) * 100) : 0;
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
    if (!duration || disabled) return;
    scrubbing.current = true;
    onScrubbingChange?.(true);
    barRef.current.setPointerCapture(e.pointerId);
    const pos = posFrom(e);
    fillRef.current.style.width = `${pos * 100}%`;
    setHover({ pos, time: pos * duration });
  };

  const onPointerMove = (e) => {
    if (!duration || disabled) return;
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
  // While preparing, everything past this point doesn't exist yet.
  const preparedPct = prepared !== null && prepared !== undefined && duration ? Math.min(100, (prepared / duration) * 100) : null;

  return (
    <div
      ref={barRef}
      className={`scrubber${disabled ? ' is-locked' : ''}`}
      role="slider"
      aria-disabled={disabled || undefined}
      title={disabled ? 'Only the host can skip around' : undefined}
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
      <div className={`scrubber-track${preparedPct !== null ? ' is-preparing' : ''}`}>
        {preparedPct !== null && <div className="scrubber-prepared" style={{ width: `${preparedPct}%` }} />}
        <div className="scrubber-buffered" style={{ width: `${bufferedPct}%` }} />
        {hover && <div className="scrubber-hover" style={{ width: `${Math.min(hover.pos * 100, preparedPct ?? 100)}%` }} />}
        <div ref={fillRef} className="scrubber-fill">
          <span className="scrubber-thumb" />
        </div>
      </div>
      {hover && (
        <div className="scrubber-tooltip mono" style={{ left: `${hover.pos * 100}%` }}>
          {formatTime(hover.time)}
          {preparedPct !== null && hover.pos * 100 > preparedPct && <span className="scrubber-tip-note"> · not ready yet</span>}
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
  onScrubbingChange,
  canPlayback = true,
  canSeek = true,
  duration: knownDuration = null,
  prepared = null
}) {
  const media = useVideoState(videoRef);
  // A streamed movie's own duration grows as it prepares; the real length comes from the server.
  const v = { ...media, duration: knownDuration || media.duration };
  const [showRemaining, setShowRemaining] = useState(false);

  return (
    <div className="controls" onClick={(e) => e.stopPropagation()}>
      <Scrubber
        videoRef={videoRef}
        duration={v.duration}
        buffered={v.buffered}
        prepared={prepared}
        onSeek={onSeek}
        onScrubbingChange={onScrubbingChange}
        disabled={!canSeek}
      />
      <div className="controls-row">
        <div className="controls-group">
          <button
            type="button"
            className="ctrl ctrl-play"
            onClick={onTogglePlay}
            disabled={!canPlayback}
            aria-label={v.paused ? 'Play' : 'Pause'}
            title={!canPlayback ? 'Only the host can play or pause' : v.paused ? 'Play (Space)' : 'Pause (Space)'}
          >
            {v.paused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
          </button>
          <button type="button" className="ctrl" onClick={() => onSkip(-10)} disabled={!canSeek} aria-label="Back 10 seconds" title="Back 10s (←)">
            <RotateCcw size={18} />
          </button>
          <button type="button" className="ctrl" onClick={() => onSkip(10)} disabled={!canSeek} aria-label="Forward 10 seconds" title="Forward 10s (→)">
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
          {prepared !== null && v.duration > 0 && (
            <span className="preparing-label" title="The host is still preparing the rest of the movie">
              Preparing {Math.min(99, Math.floor((prepared / v.duration) * 100))}%
            </span>
          )}
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
          {onChangeMovie && (
            <button type="button" className="ctrl" onClick={onChangeMovie} aria-label="Change movie" title="Change movie">
              <Clapperboard size={18} />
            </button>
          )}
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
