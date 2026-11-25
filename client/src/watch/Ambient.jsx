import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft } from 'lucide-react';
import { MAX_CHAT_LENGTH } from './Chat';
import { userColor } from '../shared/lib/format';
import { readStorage, writeStorage } from '../shared/lib/storage';

const CHIP_LIFETIME = 6000;
const MAX_CHIPS = 5;
const HINT_KEY = 'cinesync_ambient_hint_done';

/** One message bubble that removes itself after 6s; hovering or replying pauses the countdown. */
function Chip({ message, paused, onExpire }) {
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(CHIP_LIFETIME);

  useEffect(() => {
    if (paused || hovered) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(() => onExpire(message.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(600, remaining.current - (Date.now() - started));
    };
  }, [paused, hovered, message.id, onExpire]);

  return (
    <motion.div
      layout
      className={`chip${message.kind === 'system' ? ' chip-system' : ''}`}
      initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -4, filter: 'blur(4px)', transition: { duration: 0.25 } }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {message.kind === 'system' ? (
        message.text
      ) : (
        <>
          <span className="chip-name" style={{ color: userColor(message.username) }}>
            {message.username}
          </span>
          <span className="chip-text">{message.text}</span>
        </>
      )}
    </motion.div>
  );
}

/**
 * Fullscreen "ambient" chat: new messages appear as bubbles over the movie and
 * fade away. Enter opens a one-line reply bar.
 */
export default function AmbientLayer({ messages, replyOpen, onCloseReply, onOpenReply, onSend }) {
  const [chips, setChips] = useState([]);
  const lastId = useRef(messages[messages.length - 1]?.id ?? 0);
  const [text, setText] = useState('');
  const [hintDone, setHintDone] = useState(() => readStorage(HINT_KEY) === 'true');
  const inputRef = useRef(null);
  const idleTimer = useRef(0);

  // Only messages that arrive while ambient mode is showing become bubbles.
  useEffect(() => {
    const added = messages.filter((m) => m.id > lastId.current);
    if (added.length === 0) return;
    lastId.current = added[added.length - 1].id;
    setChips((current) => [...current, ...added].slice(-MAX_CHIPS));
  }, [messages]);

  const expire = useRef((id) => setChips((current) => current.filter((c) => c.id !== id))).current;

  // Reply bar: focus on open, close after 10s with nothing typed.
  useEffect(() => {
    if (!replyOpen) {
      setText('');
      return undefined;
    }
    inputRef.current?.focus();
    return undefined;
  }, [replyOpen]);

  useEffect(() => {
    window.clearTimeout(idleTimer.current);
    if (replyOpen && !text.trim()) {
      idleTimer.current = window.setTimeout(onCloseReply, 10000);
    }
    return () => window.clearTimeout(idleTimer.current);
  }, [replyOpen, text, onCloseReply]);

  const submit = () => {
    const t = text.trim();
    if (t && onSend(t)) {
      if (!hintDone) {
        setHintDone(true);
        writeStorage(HINT_KEY, 'true');
      }
    }
    onCloseReply();
  };

  return (
    <div className="ambient" aria-live="polite">
      <div className="ambient-stack">
        <AnimatePresence initial={false}>
          {chips.map((m) => (
            <Chip key={m.id} message={m} paused={replyOpen} onExpire={expire} />
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {replyOpen ? (
          <motion.form
            key="reply"
            className="ambient-reply"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18 }}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={text}
              maxLength={MAX_CHAT_LENGTH}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCloseReply();
                }
              }}
              onBlur={() => !text.trim() && onCloseReply()}
              placeholder="Message"
              aria-label="Reply to the room"
              autoComplete="off"
            />
            {text.length >= MAX_CHAT_LENGTH - 30 && (
              <span className={`ambient-count mono${text.length >= MAX_CHAT_LENGTH ? ' is-limit' : ''}`}>
                {text.length}/{MAX_CHAT_LENGTH}
              </span>
            )}
            <CornerDownLeft size={14} className={`ambient-enter${text ? ' is-ready' : ''}`} aria-hidden="true" />
          </motion.form>
        ) : (
          !hintDone && (
            <motion.button
              key="hint"
              type="button"
              className="ambient-hint"
              onClick={onOpenReply}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="kbd">Enter</span> to chat
            </motion.button>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
