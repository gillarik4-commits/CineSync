import { AnimatePresence, motion } from 'motion/react';
import { Pause } from 'lucide-react';
import Avatar from './Avatar';
import { useVideoState } from './hooks/useVideo';
import { formatDuration, formatTime } from '../shared/lib/format';
import { pausedByText } from './presence';

/** "Priya paused" style notices at the top of the player. */
export function ToastStack({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="toast"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.18 } }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {t.by ? <Avatar name={t.by} size={18} /> : null}
            <span>{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Quiet overlay while paused: what's playing, who paused, how much is left. */
export function PauseScreen({ show, videoRef, title, actor, me }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pause-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        >
          <PauseDetails videoRef={videoRef} title={title} actor={actor} me={me} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PauseDetails({ videoRef, title, actor, me }) {
  const { time, duration } = useVideoState(videoRef);
  const left = formatDuration(Math.max(0, duration - time));
  return (
    <motion.div
      className="pause-info"
      initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ delay: 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="pause-who">
        {actor?.by && actor.by !== me ? <Avatar name={actor.by} size={20} /> : <Pause size={13} fill="currentColor" />}
        <span>{pausedByText(actor, me)}</span>
      </div>
      <h1 className="pause-title">{title || 'Now playing'}</h1>
      <div className="pause-meta mono">
        {formatTime(time)} <span className="pause-sep">of</span> {formatTime(duration)}
        {left && <span className="pause-left"> · {left} left</span>}
      </div>
    </motion.div>
  );
}

/** Three-dot "Priya is typing" line. */
export function TypingLine({ text, className = '' }) {
  return (
    <div className={`typing ${className}`} aria-live="polite">
      <AnimatePresence initial={false}>
        {text && (
          <motion.span
            key="typing"
            className="typing-inner"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
