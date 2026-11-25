import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Link2, Pause, Play } from 'lucide-react';
import BlurText from '../shared/components/reactbits/BlurText';
import Dialog from '../shared/components/Dialog';
import Logo, { LogoMark } from '../shared/components/Logo';
import { useSocket } from '../shared/hooks/useSocket';
import { api } from '../shared/lib/api';
import { readStorage, writeStorage } from '../shared/lib/storage';
import Controls from './Controls';
import AmbientLayer from './Ambient';
import { ChatModeMenu, ChatPanel } from './Chat';
import Avatar from './Avatar';
import { useFullscreen } from './hooks/useFullscreen';
import { useIdle } from './hooks/useIdle';
import { PHONE_LANDSCAPE, useMediaQuery } from './hooks/useMediaQuery';
import { usePlayback } from './hooks/useVideo';
import { appendMessage, chatModeOrDefault } from './messages';
import AmbientGlow from './AmbientGlow';
import { PauseScreen, ToastStack } from './Presence';
import { actionText, pushToast, typingText } from './presence';
import { DEFAULT_PERMISSIONS, deniedText, normalizePermissions, permissionChanges } from '../shared/lib/permissions';
import RoomSettings from './RoomSettings';

const TYPING_TTL = 5000;

/** WebVTT cue text can contain tags like <i> or <c.yellow>; show plain text. */
function cueToText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

const isTypingTarget = (el) =>
  el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

export default function WatchApp() {
  const [username, setUsername] = useState(() => {
    // Rejoin automatically after the page reloads for a new movie.
    try {
      if (sessionStorage.getItem('cinesync_autojoin') === '1') {
        sessionStorage.removeItem('cinesync_autojoin');
        return readStorage('cinesync_username') || null;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const appRef = useRef(null);
  const videoRef = useRef(null);
  const chatInputRef = useRef(null);
  const remoteUntil = useRef(0);
  const tapRef = useRef({ touch: false, hidden: false });

  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [count, setCount] = useState(0);
  const [reactions, setReactions] = useState([]);
  const [mediaChanging, setMediaChanging] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const autoplayBlockedRef = useRef(false);
  autoplayBlockedRef.current = autoplayBlocked;
  const [flash, setFlash] = useState(null);
  const [confirmChange, setConfirmChange] = useState(false);

  const [chatOpen, setChatOpen] = useState(() => readStorage('cinesync_chat_open') !== 'false');
  const [chatMode, setChatModeState] = useState(() => chatModeOrDefault(readStorage('cinesync_chat_mode')));
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [captions, setCaptions] = useState({ available: false, on: false });
  const [scrubbing, setScrubbing] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [movieTitle, setMovieTitle] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [actor, setActor] = useState(null); // last play/pause: { action, by } (by null = you)
  const [typingUsers, setTypingUsers] = useState({}); // name → expiry
  const [isHost, setIsHost] = useState(false);
  const [perms, setPerms] = useState(DEFAULT_PERMISSIONS);
  const [hosts, setHosts] = useState([]);
  const [noMovie, setNoMovie] = useState(false);
  const permsRef = useRef(DEFAULT_PERMISSIONS);
  const can = {
    playback: isHost || perms.playback,
    seek: isHost || perms.seek,
    chat: isHost || perms.chat,
    reactions: isHost || perms.reactions
  };
  const canRef = useRef(can);
  canRef.current = { ...can, isHostFlag: isHost };
  const chatVisibleRef = useRef(true);
  const showAmbientRef = useRef(false);

  const [isFullscreen, toggleFullscreen] = useFullscreen(appRef, videoRef);

  // Phone turned sideways: give the movie the whole screen (chat becomes bubbles).
  // Turning back restores the saved preference.
  const phoneLandscape = useMediaQuery(PHONE_LANDSCAPE);
  const firstOrientation = useRef(true);
  useEffect(() => {
    if (firstOrientation.current && !phoneLandscape) {
      firstOrientation.current = false;
      return;
    }
    firstOrientation.current = false;
    setChatOpen(phoneLandscape ? false : readStorage('cinesync_chat_open') !== 'false');
  }, [phoneLandscape]);
  const { paused, waiting } = usePlayback(videoRef);
  const [active, poke] = useIdle(3000);
  const controlsVisible = paused || active || scrubbing || modeMenuOpen || participantsOpen || replyOpen;

  const subtitleSrc = useMemo(() => `/media/subtitles.vtt?t=${Date.now()}`, []);

  // ---------------------------------------------------------------- sync
  const isRemote = () => Date.now() < remoteUntil.current;

  const { send } = useSocket({
    enabled: Boolean(username),
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: 'HELLO' }));
      ws.send(JSON.stringify({ type: 'USER_JOIN', username }));
      ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
    },
    onMessage: (data) => {
      const v = videoRef.current;
      switch (data.type) {
        case 'SYNC_ACTION': {
          if (!v) return;
          // Ignore the play/pause events our own changes are about to fire.
          remoteUntil.current = Date.now() + 250;
          const { currentTime, action } = data.payload || {};
          if (Number.isFinite(currentTime) && (action === 'SEEK' || Math.abs(v.currentTime - currentTime) > 0.5)) {
            v.currentTime = currentTime;
          }
          if (action === 'PLAY' && v.paused) {
            v.play().catch(() => setAutoplayBlocked(true));
          } else if (action === 'PAUSE' && !v.paused) {
            v.pause();
          }
          const { by, initial } = data.payload || {};
          if (action === 'PLAY' || action === 'PAUSE') setActor({ action, by: by || null, remote: true });
          // Catch-up state on join isn't news; anything else is someone acting now.
          if (!initial) {
            const text = actionText({ action, by, currentTime });
            if (text) toast({ key: `${by}:${action === 'SEEK' ? 'seek' : 'playback'}`, by, text });
          }
          break;
        }
        case 'CHAT_MESSAGE':
          setMessages((list) =>
            appendMessage(list, {
              kind: 'chat',
              username: data.username,
              text: data.text,
              timestamp: data.timestamp || Date.now(),
              movieTime: Number.isFinite(data.movieTime) ? data.movieTime : null
            })
          );
          setTypingUsers(({ [data.username]: _, ...rest }) => rest);
          break;
        case 'SYSTEM_MESSAGE':
          setMessages((list) => appendMessage(list, { kind: 'system', text: data.text, timestamp: Date.now() }));
          // Only when chat is fully hidden (fullscreen "off"); ambient bubbles already show
          // joins and leaves, and there's no point announcing your own arrival.
          if (!chatVisibleRef.current && !showAmbientRef.current && !String(data.text).startsWith(`${username} `)) {
            toast({ key: `sys:${data.text}`, text: data.text });
          }
          break;
        case 'TYPING':
          if (!data.username || data.username === username) break;
          setTypingUsers((current) => {
            const { [data.username]: _, ...rest } = current;
            return data.typing ? { ...rest, [data.username]: Date.now() + TYPING_TTL } : rest;
          });
          break;
        case 'USER_COUNT':
          setCount(data.count);
          break;
        case 'USER_LIST':
          if (Array.isArray(data.users)) setUsers(data.users);
          if (Array.isArray(data.hosts)) setHosts(data.hosts);
          break;
        case 'WELCOME': {
          const next = normalizePermissions(data.permissions);
          permsRef.current = next;
          setIsHost(Boolean(data.isHost));
          setPerms(next);
          break;
        }
        case 'PERMISSIONS': {
          const next = normalizePermissions(data.permissions);
          // Guests get told what changed; the host just made the change themselves.
          if (!canRef.current.isHostFlag) {
            permissionChanges(permsRef.current, next).forEach((text) => toast({ key: `perm:${text}`, text }));
          }
          permsRef.current = next;
          setPerms(next);
          break;
        }
        case 'PERMISSION_DENIED':
          toast({ key: `deny:${data.capability}`, text: deniedText(data.capability) });
          break;
        case 'REACTION':
          spawnReaction(data.emoji);
          break;
        case 'MEDIA_CHANGING':
          v?.pause();
          setMediaChanging(true);
          break;
        case 'MEDIA_READY':
          // Come straight back into the room after the reload, no join screen.
          try {
            sessionStorage.setItem('cinesync_autojoin', '1');
          } catch {
            /* ignore */
          }
          window.location.reload();
          break;
        default:
      }
    }
  });

  function toast({ key, by, text }) {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => pushToast(list, { id, key, by, text }));
  }

  // Toasts fade after 3.2s (a merged toast restarts its clock).
  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setToasts((list) => {
        const next = list.filter((t) => now - t.at < 3200);
        return next.length === list.length ? list : next;
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [toasts.length]);

  // Typing entries expire if we never hear "stopped".
  useEffect(() => {
    if (Object.keys(typingUsers).length === 0) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingUsers((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([, until]) => until > now));
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [typingUsers]);

  const broadcast = useCallback(
    (action) => {
      const v = videoRef.current;
      if (!v || isRemote()) return;
      // Without permission a guest's own play/seek is just catching up; keep it local.
      if ((action === 'SEEK' && !canRef.current.seek) || (action !== 'SEEK' && !canRef.current.playback)) return;
      send({ type: 'SYNC_ACTION', payload: { action, currentTime: v.currentTime } });
    },
    [send]
  );

  // Phones pause the video when the screen locks or the browser goes to the
  // background. Those pauses must stay local, or one phone pauses the whole room.
  const hiddenAt = useRef(0);
  const pendingPause = useRef(0);
  useEffect(() => {
    const onHide = () => {
      hiddenAt.current = Date.now();
    };
    const onVisibility = () => {
      if (document.hidden) onHide();
      // Back from the background: catch up with wherever the room is now.
      else if (username) send({ type: 'REQUEST_STATE' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, [send, username]);

  // Local play/pause (from any source: buttons, keys, clicking the video) goes to the room.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const onPlay = () => {
      window.clearTimeout(pendingPause.current); // a quick pause→play never reaches the room
      setAutoplayBlocked(false);
      if (!isRemote()) setActor({ action: 'PLAY', by: null });
      broadcast('PLAY');
    };
    const onPause = () => {
      if (isRemote()) return;
      const time = v.currentTime;
      // iOS can fire "pause" just before the page reports it's hidden, so wait a beat.
      window.clearTimeout(pendingPause.current);
      pendingPause.current = window.setTimeout(() => {
        if (document.hidden || Date.now() - hiddenAt.current < 1000) return;
        if (!canRef.current.playback) {
          // Not allowed to pause the room (e.g. the iPhone's own player paused): rejoin it.
          send({ type: 'REQUEST_STATE' });
          return;
        }
        setActor({ action: 'PAUSE', by: null });
        send({ type: 'SYNC_ACTION', payload: { action: 'PAUSE', currentTime: time } });
      }, 300);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      window.clearTimeout(pendingPause.current);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [broadcast, send]);

  // ---------------------------------------------------------------- player actions
  const showFlash = (icon) => setFlash({ icon, key: Date.now() });

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!canRef.current.playback && !autoplayBlockedRef.current) {
      toast({ key: 'deny:playback', text: deniedText('playback') });
      return;
    }
    if (v.paused) {
      v.play().catch(() => setAutoplayBlocked(true));
      showFlash('play');
    } else {
      v.pause();
      showFlash('pause');
    }
    poke();
  }, [poke]);

  const seekTo = useCallback(
    (time) => {
      const v = videoRef.current;
      if (!v) return;
      if (!canRef.current.seek) {
        toast({ key: 'deny:seek', text: deniedText('seek') });
        return;
      }
      v.currentTime = Math.max(0, Math.min(v.duration || 0, time));
      broadcast('SEEK');
      poke();
    },
    [broadcast, poke]
  );

  const skip = useCallback((delta) => seekTo((videoRef.current?.currentTime || 0) + delta), [seekTo]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.5;
  }, []);

  const setVolume = useCallback((value) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = value;
    v.muted = value === 0;
    writeStorage('cinesync_volume', value);
  }, []);

  const toggleCaptions = useCallback(() => {
    setCaptions((c) => (c.available ? { ...c, on: !c.on } : c));
  }, []);

  // ---------------------------------------------------------------- chat
  const typingState = useRef({ on: false, sentAt: 0, timer: 0 });
  const sendTyping = useCallback(
    (isTyping) => {
      if (!canRef.current.chat) return;
      const t = typingState.current;
      window.clearTimeout(t.timer);
      if (isTyping) {
        // Re-announce every 3s while typing; go quiet after 4s without a keystroke.
        if (!t.on || Date.now() - t.sentAt > 3000) {
          send({ type: 'TYPING', typing: true });
          t.on = true;
          t.sentAt = Date.now();
        }
        t.timer = window.setTimeout(() => sendTyping(false), 4000);
      } else if (t.on) {
        send({ type: 'TYPING', typing: false });
        t.on = false;
      }
    },
    [send]
  );

  const sendChat = useCallback(
    (text) => {
      sendTyping(false);
      return send({
        type: 'CHAT_MESSAGE',
        text,
        username,
        timestamp: Date.now(),
        movieTime: videoRef.current?.duration ? videoRef.current.currentTime : null
      });
    },
    [send, sendTyping, username]
  );

  const sendReaction = useCallback(
    (emoji) => (canRef.current.reactions ? send({ type: 'REACTION', emoji }) : false),
    [send]
  );

  function spawnReaction(emoji) {
    const id = Math.random().toString(36).slice(2);
    setReactions((list) => [...list.slice(-20), { id, emoji, x: 70 + Math.random() * 22, drift: (Math.random() - 0.5) * 80 }]);
    window.setTimeout(() => setReactions((list) => list.filter((r) => r.id !== id)), 2600);
  }

  const setChatMode = (mode) => {
    setChatModeState(mode);
    writeStorage('cinesync_chat_mode', mode);
    setUnread(false);
  };

  const toggleChat = useCallback(() => {
    if (isFullscreen) {
      setModeMenuOpen((o) => !o);
    } else {
      setChatOpen((open) => {
        if (!phoneLandscape) writeStorage('cinesync_chat_open', String(!open));
        return !open;
      });
    }
  }, [isFullscreen, phoneLandscape]);

  const chatVisible = isFullscreen ? chatMode !== 'off' : chatOpen;
  chatVisibleRef.current = chatVisible;
  // Ambient bubbles: fullscreen ambient mode, or the room with the chat panel closed.
  const showAmbient = isFullscreen ? chatMode === 'ambient' : !chatOpen;
  showAmbientRef.current = showAmbient;
  const typingLabel = typingText(Object.keys(typingUsers));

  // Unread dot: someone else spoke while chat wasn't on screen.
  const lastMsgId = useRef(0);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastMsgId.current) return;
    lastMsgId.current = last.id;
    if (last.kind === 'chat' && last.username !== username && !chatVisible) setUnread(true);
  }, [messages, username, chatVisible]);
  useEffect(() => {
    if (chatVisible) setUnread(false);
  }, [chatVisible]);

  useEffect(() => {
    setReplyOpen(false);
    if (!isFullscreen) setModeMenuOpen(false);
  }, [isFullscreen, chatOpen]);

  // ---------------------------------------------------------------- movie title
  useEffect(() => {
    api('/api/movie')
      .then(({ title }) => {
        if (!title) return;
        setMovieTitle(title);
        document.title = `${title} · CineSync`;
      })
      .catch(() => {});
  }, []);

  // Pause screen appears after a beat, so quick pauses don't flash it.
  const [pauseScreen, setPauseScreen] = useState(false);
  const wantPauseScreen = Boolean(username) && paused && !autoplayBlocked && !scrubbing && !mediaChanging;
  useEffect(() => {
    if (!wantPauseScreen) {
      setPauseScreen(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if ((videoRef.current?.duration || 0) > 0) setPauseScreen(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [wantPauseScreen]);

  // ---------------------------------------------------------------- video element setup
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const saved = parseFloat(readStorage('cinesync_volume'));
    if (Number.isFinite(saved)) v.volume = Math.max(0, Math.min(1, saved));
  }, []);

  // Subtitles are optional: the CC button only enables once the .vtt actually loads.
  // The track stays "hidden" so the browser doesn't draw it; we render the active
  // cue ourselves so it can move above the controls and stay readable.
  const trackRef = useRef(null);
  const [cueText, setCueText] = useState('');
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const track = el.track;
    track.mode = 'hidden';
    const onCue = () => {
      const lines = Array.from(track.activeCues || []).map((cue) => cueToText(cue.text));
      setCueText(lines.join('\n'));
    };
    const onLoad = () => {
      track.mode = 'hidden';
      setCaptions((c) => ({ available: true, on: c.available ? c.on : true }));
    };
    const onError = () => setCaptions({ available: false, on: false });
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    track.addEventListener('cuechange', onCue);
    if (el.readyState === 2) onLoad();
    return () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
      track.removeEventListener('cuechange', onCue);
    };
  }, []);

  // iPhone fullscreen is Apple's own player, which can't show our overlay. While
  // it's open, let the browser draw the subtitles; hand them back afterwards.
  const captionsOnRef = useRef(false);
  captionsOnRef.current = captions.on;
  useEffect(() => {
    const v = videoRef.current;
    const track = trackRef.current?.track;
    if (!v || !track) return undefined;
    const onBegin = () => {
      if (captionsOnRef.current) track.mode = 'showing';
    };
    const onEnd = () => {
      track.mode = 'hidden';
    };
    v.addEventListener('webkitbeginfullscreen', onBegin);
    v.addEventListener('webkitendfullscreen', onEnd);
    return () => {
      v.removeEventListener('webkitbeginfullscreen', onBegin);
      v.removeEventListener('webkitendfullscreen', onEnd);
    };
  }, []);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (!username) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.dialog-backdrop')) return;
      if (isTypingTarget(document.activeElement)) return;

      if (e.key === 'Enter' && showAmbient && !replyOpen && !e.repeat && canRef.current.chat) {
        e.preventDefault();
        document.activeElement?.blur?.();
        setReplyOpen(true);
        return;
      }

      const actions = {
        Space: togglePlay,
        KeyK: togglePlay,
        ArrowLeft: () => skip(-10),
        ArrowRight: () => skip(10),
        KeyJ: () => skip(-10),
        KeyL: () => skip(10),
        KeyM: toggleMute,
        KeyC: toggleCaptions,
        KeyF: toggleFullscreen,
        KeyT: toggleChat
      };
      const action = actions[e.code];
      if (!action) return;
      // Let Space/Enter activate a focused button normally.
      if (e.code === 'Space' && document.activeElement?.tagName === 'BUTTON') return;
      e.preventDefault();
      action();
      poke();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [username, showAmbient, replyOpen, togglePlay, skip, toggleMute, toggleCaptions, toggleFullscreen, toggleChat, poke]);

  // ---------------------------------------------------------------- change movie
  const changeMovie = async () => {
    try {
      await api('/api/reset-party', { method: 'POST' });
    } catch {
      /* go to setup regardless */
    }
    window.location.assign('/');
  };

  const closeReply = useCallback(() => setReplyOpen(false), []);
  const openReply = useCallback(() => setReplyOpen(true), []);

  const showFloatingPanel = isFullscreen && chatMode === 'panel';
  const showTheatreChat = !isFullscreen && chatOpen;

  return (
    <div
      ref={appRef}
      className={`watch${isFullscreen ? ' is-fullscreen' : ''}${showTheatreChat ? ' has-chat' : ''}${controlsVisible ? '' : ' is-idle'}${pauseScreen ? ' is-paused-screen' : ''}`}
      onPointerMove={poke}
      onPointerDown={poke}
    >
      <AmbientGlow videoRef={videoRef} enabled={!isFullscreen} />

      <div
        className="stage"
        onPointerDown={(e) => {
          tapRef.current = { touch: e.pointerType !== 'mouse', hidden: !controlsVisible };
        }}
        onClick={() => {
          // On touch, the first tap on a hidden player just brings the controls back.
          if (tapRef.current.touch && tapRef.current.hidden) return;
          togglePlay();
        }}
        onDoubleClick={toggleFullscreen}
      >
        <video
          ref={videoRef}
          className="video"
          src="/video"
          preload="metadata"
          playsInline
          crossOrigin="anonymous"
          onError={() => setNoMovie(true)}
          onLoadedMetadata={() => setNoMovie(false)}
        >
          <track ref={trackRef} kind="subtitles" src={subtitleSrc} srcLang="en" label="Subtitles" default />
        </video>

        <div className="stage-shade" aria-hidden="true" />

        {captions.on && cueText && (
          <div className="captions" aria-live="off">
            {cueText.split('\n').map((line, i) => (
              <span key={i} className="caption-line">
                {line}
              </span>
            ))}
          </div>
        )}

        <PauseScreen show={pauseScreen} videoRef={videoRef} title={movieTitle} actor={actor} me={username} />

        <header className="topbar" onClick={(e) => e.stopPropagation()}>
          <div className="topbar-title">
            <Logo size={20} />
            {movieTitle && (
              <>
                <span className="topbar-divider" aria-hidden="true" />
                <span className="topbar-movie" title={movieTitle}>
                  {movieTitle}
                </span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {isHost && <RoomSettings permissions={perms} onChange={(next) => {
              permsRef.current = next;
              setPerms(next);
              send({ type: 'SET_PERMISSIONS', permissions: next });
            }} />}
            <Participants
              users={users}
              hosts={hosts}
              count={count}
              me={username}
              open={participantsOpen}
              setOpen={setParticipantsOpen}
            />
            <InviteButton />
          </div>
        </header>

        <ToastStack toasts={toasts} />

        <AnimatePresence>
          {flash && (
            <motion.div
              key={flash.key}
              className="flash"
              initial={{ opacity: 0.9, scale: 0.9 }}
              animate={{ opacity: 0, scale: 1.25 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              onAnimationComplete={() => setFlash(null)}
              aria-hidden="true"
            >
              {flash.icon === 'play' ? <Play size={28} fill="currentColor" /> : <Pause size={28} fill="currentColor" />}
            </motion.div>
          )}
        </AnimatePresence>

        {waiting && !paused && <div className="buffering spinner" aria-label="Buffering" />}

        <div className="reactions-layer" aria-hidden="true">
          {reactions.map((r) => (
            <span key={r.id} className="floating-reaction" style={{ left: `${r.x}%`, '--drift': `${r.drift}px` }}>
              {r.emoji}
            </span>
          ))}
        </div>

        {showAmbient && (
          <AmbientLayer
            canChat={can.chat}
            messages={messages}
            replyOpen={replyOpen}
            onCloseReply={closeReply}
            onOpenReply={openReply}
            onSend={sendChat}
            typing={typingLabel}
            onTyping={sendTyping}
          />
        )}

        {autoplayBlocked && (
          <div className="center-overlay" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => {
                const v = videoRef.current;
                v.muted = false;
                v.play().then(() => setAutoplayBlocked(false)).catch(() => {});
              }}
            >
              <Play size={16} fill="currentColor" />
              Start watching
            </button>
            <p>Your browser needs a click before it plays sound.</p>
          </div>
        )}

        {username && noMovie && !mediaChanging && (
          <div className="stage-overlay waiting" onClick={(e) => e.stopPropagation()}>
            <span className="join-mark">
              <LogoMark size={26} />
            </span>
            <p className="overlay-title">{isHost ? 'No movie is playing' : 'Waiting for the host'}</p>
            <p className="overlay-sub">
              {isHost ? 'Pick something to watch to start the party.' : 'The movie will start here as soon as it’s ready.'}
            </p>
            {isHost ? (
              <a className="btn btn-primary btn-sm waiting-btn" href="/">
                Choose a movie
              </a>
            ) : (
              <div className="spinner waiting-spinner" />
            )}
          </div>
        )}

        <Controls
          videoRef={videoRef}
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onSkip={skip}
          onToggleMute={toggleMute}
          onVolume={setVolume}
          captions={captions}
          onToggleCaptions={toggleCaptions}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          onToggleChat={toggleChat}
          onChatContextMenu={(e) => {
            e.preventDefault();
            setModeMenuOpen((o) => !o);
          }}
          chatActive={chatVisible}
          chatUnread={unread}
          chatMenu={
            <ChatModeMenu open={modeMenuOpen} mode={chatMode} onSelect={setChatMode} onClose={() => setModeMenuOpen(false)} />
          }
          onChangeMovie={isHost ? () => setConfirmChange(true) : null}
          canPlayback={can.playback}
          canSeek={can.seek}
          onScrubbingChange={setScrubbing}
        />
      </div>

      <AnimatePresence>
        {(showTheatreChat || showFloatingPanel) && (
          <motion.div
            key={showFloatingPanel ? 'floating' : 'theatre'}
            className={`chat-shell chat-shell-${showFloatingPanel ? 'floating' : 'theatre'}`}
            initial={{ opacity: 0, x: showFloatingPanel ? 0 : 28, scale: showFloatingPanel ? 0.97 : 1 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: showFloatingPanel ? 0 : 28, transition: { duration: 0.2 } }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <ChatPanel
              canChat={can.chat}
              canReact={can.reactions}
              variant={showFloatingPanel ? 'floating' : 'theatre'}
              messages={messages}
              me={username}
              count={count}
              typing={typingLabel}
              onSend={sendChat}
              onReact={sendReaction}
              onTyping={sendTyping}
              inputRef={chatInputRef}
              onClose={() => (isFullscreen ? setChatMode('off') : toggleChat())}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!username && <JoinScreen onJoin={setUsername} />}

      <AnimatePresence>
        {mediaChanging && (
          <motion.div className="fullscreen-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="spinner" />
            <p className="overlay-title">The host is switching movies</p>
            <p className="overlay-sub">You’ll rejoin automatically when it’s ready.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog
        open={confirmChange}
        onClose={() => setConfirmChange(false)}
        title="Change the movie?"
        description="Playback stops for everyone while you pick something new. They’ll rejoin automatically."
        hideClose
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmChange(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={changeMovie}>
              Change movie
            </button>
          </>
        }
      />
    </div>
  );
}

function Participants({ users, hosts = [], count, me, open, setOpen }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const shown = users.slice(0, 3);
  return (
    <div className="participants" ref={ref}>
      <button
        type="button"
        className="pill-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Who’s watching"
      >
        <span className="avatar-stack">
          {shown.map((u) => (
            <Avatar key={u} name={u} size={20} />
          ))}
        </span>
        <span className="live-dot" />
        <span>{count || users.length || 1} watching</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu participants-menu"
            role="dialog"
            aria-label="People watching"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <div className="menu-label">In the room</div>
            {users.length === 0 ? (
              <div className="menu-empty">Connecting…</div>
            ) : (
              users.map((u, i) => (
                <div key={`${u}-${i}`} className="participant">
                  <Avatar name={u} size={24} />
                  <span className="participant-name">{u}</span>
                  {hosts.includes(u) && <span className="participant-host">Host</span>}
                  {u === me && <span className="participant-you">You</span>}
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InviteButton() {
  const [state, setState] = useState('idle'); // idle | copied | error
  const copy = async () => {
    try {
      const { url } = await api('/api/share-url');
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('error');
    }
    window.setTimeout(() => setState('idle'), 2000);
  };
  return (
    <button type="button" className="pill-btn pill-btn-solid" onClick={copy} title="Copy the invite link">
      {state === 'copied' ? <Check size={14} /> : <Link2 size={14} />}
      <span>{state === 'copied' ? 'Link copied' : state === 'error' ? 'Couldn’t copy' : 'Invite'}</span>
    </button>
  );
}

function JoinScreen({ onJoin }) {
  const [name, setName] = useState(() => readStorage('cinesync_username') || '');
  const submit = (e) => {
    e.preventDefault();
    const n = name.trim().slice(0, 32);
    if (!n) return;
    writeStorage('cinesync_username', n);
    onJoin(n);
  };
  return (
    <div className="join">
      <div className="page-backdrop" aria-hidden="true" />
      <motion.form
        className="join-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="join-mark">
          <LogoMark size={28} />
        </span>
        <BlurText
          text="Join the watch party"
          className="join-title"
          delay={80}
          stepDuration={0.3}
          blur={8}
          distance={12}
          trigger="load"
        />
        <p className="join-sub">Pick a name so everyone knows who’s here.</p>
        <input
          className="input join-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={32}
          autoComplete="nickname"
          autoFocus
          aria-label="Your name"
        />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!name.trim()}>
          Join
        </button>
      </motion.form>
    </div>
  );
}
