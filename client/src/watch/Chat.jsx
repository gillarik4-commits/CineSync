import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ChevronDown, ChevronUp, GripHorizontal, Lock, SendHorizontal, X } from 'lucide-react';
import { formatTime, userColor } from '../shared/lib/format';
import Avatar from './Avatar';
import { TypingLine } from './Presence';

export { Avatar };

export const REACTIONS = ['🔥', '😂', '😮', '❤️', '🍿'];
export const MAX_CHAT_LENGTH = 200;

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function MessageItem({ message, me }) {
  if (message.kind === 'system') {
    return <div className="msg-system">{message.text}</div>;
  }
  const own = message.username === me;
  return (
    <div className={`msg${message.grouped ? ' is-grouped' : ''}${own ? ' is-own' : ''}`}>
      {!message.grouped && (
        <div className="msg-head">
          <Avatar name={message.username} size={20} />
          <span className="msg-name" style={{ color: userColor(message.username) }}>
            {message.username}
            {own && <span className="msg-you"> (you)</span>}
          </span>
          {Number.isFinite(message.movieTime) ? (
            <time className="msg-time msg-movietime mono" title={`Sent at ${timeOf(message.timestamp)}, ${formatTime(message.movieTime)} into the movie`}>
              {formatTime(message.movieTime)}
            </time>
          ) : (
            <time className="msg-time">{timeOf(message.timestamp)}</time>
          )}
        </div>
      )}
      <div className="msg-body">{message.text}</div>
    </div>
  );
}

/** Scrolls to the newest message unless the reader has scrolled up, then shows a pill instead. */
function MessageList({ messages, me }) {
  const ref = useRef(null);
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const lastId = useRef(messages[messages.length - 1]?.id ?? 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const added = messages.filter((m) => m.id > lastId.current);
    if (added.length) lastId.current = added[added.length - 1].id;
    if (added.length === 0) return;
    const mine = added.some((m) => m.kind === 'chat' && m.username === me);
    if (atBottom.current || mine) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(false);
    } else if (added.some((m) => m.kind === 'chat')) {
      setNewBelow(true);
    }
  }, [messages, me]);

  // Start at the bottom when the list (re)mounts, e.g. switching chat styles.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, []);

  const onScroll = () => {
    const el = ref.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current) setNewBelow(false);
  };

  return (
    <div className="msg-list-wrap">
      <div ref={ref} className="msg-list" onScroll={onScroll} role="log" aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 ? (
          <div className="msg-empty">
            <p>No messages yet</p>
            <span>Say hi, or react with an emoji.</span>
          </div>
        ) : (
          messages.map((m) => <MessageItem key={m.id} message={m} me={me} />)
        )}
      </div>
      <AnimatePresence>
        {newBelow && (
          <motion.button
            type="button"
            className="new-pill"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            onClick={() => {
              ref.current.scrollTop = ref.current.scrollHeight;
              setNewBelow(false);
            }}
          >
            <ArrowDown size={13} /> New messages
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Composer({ onSend, onReact, onTyping, inputRef, placeholder = 'Message the room', autoFocus, canChat = true, canReact = true }) {
  const [text, setText] = useState('');
  if (!canChat && !canReact) {
    return (
      <div className="composer composer-locked">
        <Lock size={13} /> The host has turned off chat and reactions
      </div>
    );
  }
  const send = () => {
    const t = text.trim();
    if (!t) return;
    if (onSend(t)) {
      setText('');
      onTyping?.(false);
    }
  };
  return (
    <div className="composer">
      {canReact && (
        <div className="reactions" role="group" aria-label="Send a reaction">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className="reaction-btn" onClick={() => onReact(emoji)} aria-label={`React ${emoji}`}>
              {emoji}
            </button>
          ))}
        </div>
      )}
      {!canChat ? (
        <div className="composer-note">
          <Lock size={13} /> The host has turned off chat
        </div>
      ) : (
      <form
        className="composer-row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          className="composer-input"
          type="text"
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          onChange={(e) => {
            setText(e.target.value);
            onTyping?.(e.target.value.trim().length > 0);
          }}
          onBlur={() => onTyping?.(false)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={placeholder}
          autoComplete="off"
          aria-label="Chat message"
          autoFocus={autoFocus}
        />
        <button type="submit" className="send-btn" disabled={!text.trim()} aria-label="Send">
          <SendHorizontal size={16} />
        </button>
      </form>
      )}
    </div>
  );
}

/**
 * The chat panel. Normally a glass panel that slides over the right of the
 * room ("theatre"); in fullscreen "panel" mode it floats, can be dragged by its
 * handle, and tucks itself away after 8s idle.
 */
export function ChatPanel({ variant, messages, me, count, typing, onSend, onReact, onTyping, onClose, inputRef, onActivity, canChat = true, canReact = true }) {
  const floating = variant === 'floating';
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const idleTimer = useRef(0);
  const drag = useRef(null);

  const wake = () => {
    if (!floating) return;
    setMinimized(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      const el = panelRef.current;
      if (el && !el.matches(':hover') && !el.contains(document.activeElement)) setMinimized(true);
    }, 8000);
  };

  useEffect(() => {
    if (!floating) return undefined;
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [floating]); // eslint-disable-line react-hooks/exhaustive-deps

  // New messages bring a tucked-away panel back.
  useEffect(() => {
    if (floating && messages.length) wake();
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragStart = (e) => {
    if (!floating) return;
    const rect = panelRef.current.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const el = panelRef.current;
    const left = Math.max(12, Math.min(window.innerWidth - el.offsetWidth - 12, d.left + e.clientX - d.x));
    const top = Math.max(12, Math.min(window.innerHeight - el.offsetHeight - 12, d.top + e.clientY - d.y));
    setPos({ left, top });
  };
  const onDragEnd = () => {
    drag.current = null;
  };

  return (
    <aside
      ref={panelRef}
      className={`chat chat-${variant}${minimized ? ' is-minimized' : ''}`}
      style={floating && pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}
      onPointerMove={() => {
        wake();
        onActivity?.();
      }}
      onFocus={wake}
      aria-label="Chat"
    >
      <header className="chat-header">
        {floating && (
          <span
            className="chat-grip"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            title="Drag to move"
          >
            <GripHorizontal size={14} />
          </span>
        )}
        <span className="chat-title">Chat</span>
        <span className="chat-count">{count} watching</span>
        <span className="chat-header-actions">
          {floating && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMinimized((m) => !m)}
              aria-label={minimized ? 'Expand chat' : 'Minimize chat'}
            >
              {minimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close chat" title="Close (T)">
            <X size={15} />
          </button>
        </span>
      </header>
      {!minimized && (
        <>
          <MessageList messages={messages} me={me} />
          <TypingLine text={typing} />
          <Composer onSend={onSend} onReact={onReact} onTyping={onTyping} inputRef={inputRef} canChat={canChat} canReact={canReact} />
        </>
      )}
    </aside>
  );
}

const MODES = [
  { id: 'ambient', label: 'Ambient', desc: 'Messages drift in, then fade' },
  { id: 'panel', label: 'Panel', desc: 'A small floating chat window' },
  { id: 'off', label: 'Off', desc: 'Hidden, with an unread dot' }
];

export function ChatModeMenu({ open, mode, onSelect, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !e.target.closest?.('.chat-btn-wrap')) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          className="menu chat-mode-menu"
          role="menu"
          aria-label="Fullscreen chat style"
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.14 }}
        >
          <div className="menu-label">Chat in fullscreen</div>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={mode === m.id}
              className={`menu-item${mode === m.id ? ' is-checked' : ''}`}
              onClick={() => {
                onSelect(m.id);
                onClose();
              }}
            >
              <span className="menu-radio" />
              <span className="menu-text">
                <span>{m.label}</span>
                <span className="menu-desc">{m.desc}</span>
              </span>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
