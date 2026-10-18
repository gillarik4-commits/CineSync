// ==========================================================================
// CineSync App Client Controller
// ==========================================================================

const player = document.getElementById('player');
const playerWrapper = document.getElementById('player-wrapper');
const appContainer = document.getElementById('app-container');
const controlsBar = document.getElementById('controls-bar');
const playerHeader = document.getElementById('player-header');
const scrubber = document.getElementById('scrubber');
const scrubberFill = document.getElementById('scrubber-fill');
const scrubberHover = document.getElementById('scrubber-hover');
const timeDisplay = document.getElementById('time-display');

const btnPlayPause = document.getElementById('btn-playpause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');

const btnSkipBack = document.getElementById('btn-skipback');
const btnSkipFwd = document.getElementById('btn-skipfwd');
const btnMute = document.getElementById('btn-mute');
const iconVolHigh = document.getElementById('icon-vol-high');
const iconVolMuted = document.getElementById('icon-vol-muted');
const volumeSlider = document.getElementById('volume-slider');

const btnCC = document.getElementById('btn-cc');
const btnFullscreen = document.getElementById('btn-fullscreen');
const iconFsEnter = document.getElementById('icon-fs-enter');
const iconFsExit = document.getElementById('icon-fs-exit');

const btnChatToggle = document.getElementById('btn-chat');
const btnChangeMedia = document.getElementById('btn-change-media');

const chatPanel = document.getElementById('chat-panel');
const btnCloseChat = document.getElementById('btn-close-chat');
const btnMinimizeChat = document.getElementById('btn-minimize-chat');
const hudDragHandle = document.getElementById('hudDragHandle');
const hudCornerHandle = document.getElementById('hudCornerHandle');
const chatFeed = document.getElementById('chatFeed');
const newMessagesPill = document.getElementById('newMessagesPill');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const reactionBtns = document.querySelectorAll('.reaction-btn');
const ambientReplyHint = document.getElementById('ambientReplyHint');
const ambientHintKey = document.getElementById('ambientHintKey');
const ambientReturnGlyph = document.getElementById('ambientReturnGlyph');
const ambientCharCounter = document.getElementById('ambientCharCounter');

const chatBtnWrapper = document.getElementById('chatBtnWrapper');
const chatModeMenu = document.getElementById('chatModeMenu');
const chatModeOptions = document.querySelectorAll('.chat-mode-option');
const chatUnreadDot = document.getElementById('chatUnreadDot');

const shareBtn = document.getElementById('shareBtn');
const shareBtnText = document.getElementById('shareBtnText');
const onlinePillBtn = document.getElementById('onlinePillBtn');
const userCountBadge = document.getElementById('userCountBadge');
const participantsPopover = document.getElementById('participantsPopover');
const participantsList = document.getElementById('participantsList');

const bufferingIndicator = document.getElementById('bufferingIndicator');
const autoplayOverlay = document.getElementById('autoplayOverlay');
const autoplayBtn = document.getElementById('autoplayBtn');
const mediaChangingOverlay = document.getElementById('mediaChangingOverlay');

let ws;
let isRemoteUpdate = false;
let username = '';
let idleTimer;
let isScrubbing = false;
let activeParticipants = [];

// Chat Mode State ('ambient', 'panel', 'off')
let currentChatMode = localStorage.getItem('cinesync_chat_mode') || 'ambient';
if (!['ambient', 'panel', 'off'].includes(currentChatMode)) {
  currentChatMode = 'ambient';
}

let panelIdleTimer = null;

// ==========================================================================
// Join Modal & Local Storage
// ==========================================================================
const joinModal = document.getElementById('joinModal');
const joinForm = document.getElementById('joinForm');
const usernameInput = document.getElementById('usernameInput');

const savedUsername = localStorage.getItem('cinesync_username');
if (savedUsername && usernameInput) {
  usernameInput.value = savedUsername;
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (name) {
    username = name;
    localStorage.setItem('cinesync_username', username);
    joinModal.style.display = 'none';
    initWebSocket();
  }
});

// Setup video player source and cache-busted subtitles
player.src = '/video';
player.controls = false;

const subTrack = document.getElementById('sub-track');
if (subTrack) {
  subTrack.src = `/media/subtitles.vtt?t=${Date.now()}`;
}

// ==========================================================================
// ==========================================================================
// Inactivity Fade-Out (Controls & Header)
// ==========================================================================
function updateControlsOffset(visible) {
  if (visible) {
    appContainer.classList.remove('controls-idle');
    const h = controlsBar.offsetHeight || 80;
    document.documentElement.style.setProperty('--controls-offset', `${h}px`);
  } else {
    appContainer.classList.add('controls-idle');
    document.documentElement.style.setProperty('--controls-offset', '0px');
  }
}

function resetIdleTimer() {
  controlsBar.style.opacity = '1';
  playerHeader.style.opacity = '1';
  appContainer.style.cursor = 'default';
  updateControlsOffset(true);
  clearTimeout(idleTimer);

  if (!player.paused) {
    idleTimer = setTimeout(() => {
      if (!player.paused && !isScrubbing) {
        controlsBar.style.opacity = '0';
        playerHeader.style.opacity = '0';
        appContainer.style.cursor = 'none';
        updateControlsOffset(false);
        if (participantsPopover) participantsPopover.classList.remove('active');
        if (chatModeMenu) chatModeMenu.classList.remove('active');
      }
    }, 3000);
  }
}

updateControlsOffset(true);

appContainer.addEventListener('mousemove', resetIdleTimer);
appContainer.addEventListener('click', resetIdleTimer);
appContainer.addEventListener('keydown', resetIdleTimer);

// ==========================================================================
// Buffering & Autoplay Handling
// ==========================================================================
player.addEventListener('waiting', () => {
  if (bufferingIndicator) bufferingIndicator.classList.add('active');
});

player.addEventListener('playing', () => {
  if (bufferingIndicator) bufferingIndicator.classList.remove('active');
  if (autoplayOverlay) autoplayOverlay.classList.remove('active');
  updatePlayPauseUI(true);
});

player.addEventListener('canplay', () => {
  if (bufferingIndicator) bufferingIndicator.classList.remove('active');
});

function showAutoplayOverlay() {
  if (autoplayOverlay) autoplayOverlay.classList.add('active');
}

autoplayBtn.addEventListener('click', () => {
  if (autoplayOverlay) autoplayOverlay.classList.remove('active');
  player.muted = false;
  player.play().catch(console.error);
});

// ==========================================================================
// Time Display & Scrubber (Pointer Drag Scrubbing)
// ==========================================================================
function formatTime(sec) {
  if (isNaN(sec) || !isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

player.addEventListener('timeupdate', () => {
  if (!isScrubbing) {
    timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
    const pct = (player.currentTime / (player.duration || 1)) * 100 || 0;
    scrubberFill.style.width = `${pct}%`;
  }
});

function getScrubberPosition(e) {
  const rect = scrubber.getBoundingClientRect();
  const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
  const pos = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(1, pos));
}

// Scrubber Pointer Events for Real Drag Scrubbing
scrubber.addEventListener('pointerdown', (e) => {
  isScrubbing = true;
  scrubber.classList.add('scrubbing');
  scrubber.setPointerCapture(e.pointerId);

  const pos = getScrubberPosition(e);
  scrubberFill.style.width = `${pos * 100}%`;
  scrubberHover.style.display = 'block';
  scrubberHover.style.left = `${pos * 100}%`;
  scrubberHover.textContent = formatTime(pos * (player.duration || 0));
});

scrubber.addEventListener('pointermove', (e) => {
  const pos = getScrubberPosition(e);
  scrubberHover.style.left = `${pos * 100}%`;
  scrubberHover.textContent = formatTime(pos * (player.duration || 0));

  if (isScrubbing) {
    scrubberFill.style.width = `${pos * 100}%`;
  }
});

scrubber.addEventListener('pointerenter', () => {
  scrubberHover.style.display = 'block';
});

scrubber.addEventListener('pointerleave', () => {
  if (!isScrubbing) {
    scrubberHover.style.display = 'none';
  }
});

function finishScrub(e) {
  if (!isScrubbing) return;
  isScrubbing = false;
  scrubber.classList.remove('scrubbing');
  scrubberHover.style.display = 'none';

  if (e.pointerId && scrubber.hasPointerCapture(e.pointerId)) {
    scrubber.releasePointerCapture(e.pointerId);
  }

  const pos = getScrubberPosition(e);
  const targetTime = pos * (player.duration || 0);
  player.currentTime = targetTime;
  broadcastSync('SEEK');
}

scrubber.addEventListener('pointerup', finishScrub);
scrubber.addEventListener('pointercancel', finishScrub);

// ==========================================================================
// Player Controls Actions
// ==========================================================================
function updatePlayPauseUI(isPlaying) {
  if (isPlaying) {
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
  } else {
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
  }
}

function handlePlayPause() {
  if (player.paused) {
    player.play().catch(showAutoplayOverlay);
  } else {
    player.pause();
  }
}

btnPlayPause.addEventListener('click', handlePlayPause);

player.addEventListener('play', () => {
  updatePlayPauseUI(true);
  broadcastSync('PLAY');
  resetIdleTimer();
});

player.addEventListener('pause', () => {
  updatePlayPauseUI(false);
  broadcastSync('PAUSE');
  resetIdleTimer();
});

function handleSkipBack() {
  player.currentTime = Math.max(0, player.currentTime - 10);
  broadcastSync('SEEK');
  resetIdleTimer();
}

function handleSkipFwd() {
  player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
  broadcastSync('SEEK');
  resetIdleTimer();
}

btnSkipBack.addEventListener('click', handleSkipBack);
btnSkipFwd.addEventListener('click', handleSkipFwd);

// Click-to-play on the video wrapper (ignoring interactive controls)
playerWrapper.addEventListener('click', (e) => {
  if (e.target === playerWrapper || e.target === player) {
    handlePlayPause();
    resetIdleTimer();
  }
});

// Volume & Mute
function handleMuteToggle() {
  player.muted = !player.muted;
  updateVolumeUI();
}

function updateVolumeUI() {
  if (player.muted || player.volume === 0) {
    iconVolHigh.style.display = 'none';
    iconVolMuted.style.display = 'block';
  } else {
    iconVolHigh.style.display = 'block';
    iconVolMuted.style.display = 'none';
  }
}

btnMute.addEventListener('click', handleMuteToggle);

volumeSlider.addEventListener('input', (e) => {
  player.volume = parseFloat(e.target.value);
  player.muted = player.volume === 0;
  updateVolumeUI();
});

// Subtitles Toggle
function handleCCToggle() {
  const track = player.textTracks[0];
  if (track) {
    track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
    btnCC.style.color = track.mode === 'showing' ? 'var(--accent)' : 'var(--text-dim)';
  }
}
btnCC.addEventListener('click', handleCCToggle);
btnCC.style.color = 'var(--text-dim)';

// Fullscreen Toggle
function handleFullscreenToggle() {
  if (!document.fullscreenElement) {
    appContainer.requestFullscreen().catch(console.error);
  } else {
    document.exitFullscreen().catch(console.error);
  }
}

btnFullscreen.addEventListener('click', handleFullscreenToggle);

// Change Media (Host)
btnChangeMedia.addEventListener('click', async () => {
  const ok = confirm('Are you sure you want to change the movie? This will interrupt playback for everyone.');
  if (ok) {
    try {
      await fetch('/api/reset-party', { method: 'POST' });
    } catch (err) {
      console.error('Reset party failed', err);
    }
    window.location.href = '/';
  }
});

// Share Link
shareBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/share-url');
    const data = await res.json();
    if (data.url) {
      await navigator.clipboard.writeText(data.url);
      shareBtnText.textContent = 'Link copied';
      setTimeout(() => {
        shareBtnText.textContent = 'Share Link';
      }, 2000);
    }
  } catch (err) {
    console.error('Share failed', err);
  }
});

// ==========================================================================
// Participants Popover
// ==========================================================================
onlinePillBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  participantsPopover.classList.toggle('active');
  renderParticipantsList();
});

document.addEventListener('click', (e) => {
  if (!participantsPopover.contains(e.target) && e.target !== onlinePillBtn) {
    participantsPopover.classList.remove('active');
  }
});

function renderParticipantsList() {
  participantsList.innerHTML = '';
  if (activeParticipants.length > 0) {
    activeParticipants.forEach(u => {
      const item = document.createElement('div');
      item.className = 'participant-item';
      item.innerHTML = `<span class="user-avatar">${u.charAt(0).toUpperCase()}</span><span>${escapeHtml(u)}${u === username ? ' (You)' : ''}</span>`;
      participantsList.appendChild(item);
    });
  } else {
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.innerHTML = `<span class="user-avatar">•</span><span>${userCountBadge.textContent}</span>`;
    participantsList.appendChild(item);
  }
}

// ==========================================================================
// Fullscreen Chat Modes ('ambient', 'panel', 'off')
// ==========================================================================
const USER_COLORS = ['#F2A33A', '#E5775B', '#7FC8A9', '#D9C26F', '#6FB3D9', '#C9C5BE'];
function getUserColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return USER_COLORS[hash % USER_COLORS.length];
}

if (ambientHintKey) {
  ambientHintKey.textContent = 'Enter';
}

function updateAmbientHintUI() {
  if (!chatPanel) return;
  const isDone = localStorage.getItem('cinesync_ambient_hint_done') === 'true';
  if (isDone) {
    chatPanel.classList.add('hint-done');
  } else {
    chatPanel.classList.remove('hint-done');
  }
}

function updateModeMenuUI() {
  chatModeOptions.forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === currentChatMode);
  });
}

function setChatMode(mode) {
  if (!['ambient', 'panel', 'off'].includes(mode)) mode = 'ambient';
  currentChatMode = mode;
  localStorage.setItem('cinesync_chat_mode', mode);
  updateModeMenuUI();

  if (document.fullscreenElement) {
    applyFullscreenChatMode();
  }
}

function applyFullscreenChatMode() {
  chatPanel.classList.remove('fs-chat-ambient', 'fs-chat-panel', 'fs-chat-off', 'ambient-reply-active', 'hud-minimized');
  clearTimeout(panelIdleTimer);
  hideAmbientReplyBar();

  if (currentChatMode === 'ambient') {
    chatPanel.classList.add('fs-chat-ambient');
    chatPanel.style.left = '';
    chatPanel.style.top = '';
    chatPanel.style.right = '';
    chatPanel.style.bottom = '';
    chatPanel.style.width = '';
    chatPanel.style.height = '';

    // In ambient mode, mark older messages as faded out so the screen is clear by default
    const existing = chatFeed.querySelectorAll('.msg, .system-msg');
    existing.forEach(node => node.classList.add('ambient-faded'));

    if (chatUnreadDot) chatUnreadDot.style.display = 'none';
    updateAmbientHintUI();
  }
  else if (currentChatMode === 'panel') {
    chatPanel.classList.add('fs-chat-panel');
    const existing = chatFeed.querySelectorAll('.msg, .system-msg');
    existing.forEach(node => node.classList.remove('ambient-faded', 'ambient-chip-exiting'));
    chatFeed.scrollTop = chatFeed.scrollHeight;

    if (chatUnreadDot) chatUnreadDot.style.display = 'none';
    resetPanelIdleTimer();
  }
  else if (currentChatMode === 'off') {
    chatPanel.classList.add('fs-chat-off');
  }
}

function restoreNormalChat() {
  hideAmbientReplyBar();
  clearTimeout(ambientReplyTypingTimer);
  chatPanel.classList.remove('fs-chat-ambient', 'fs-chat-panel', 'fs-chat-off', 'ambient-reply-active', 'ambient-reply-closing', 'ambient-reply-idle', 'hud-minimized');
  chatPanel.style.left = '';
  chatPanel.style.top = '';
  chatPanel.style.right = '';
  chatPanel.style.bottom = '';
  chatPanel.style.width = '';
  chatPanel.style.height = '';

  const existing = chatFeed.querySelectorAll('.msg, .system-msg');
  existing.forEach(node => node.classList.remove('ambient-faded', 'ambient-chip-exiting'));
  chatFeed.scrollTop = chatFeed.scrollHeight;

  if (chatUnreadDot) chatUnreadDot.style.display = 'none';
  if (chatModeMenu) chatModeMenu.classList.remove('active');
  clearTimeout(panelIdleTimer);
}

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  iconFsEnter.style.display = isFs ? 'none' : 'block';
  iconFsExit.style.display = isFs ? 'block' : 'none';

  if (isFs) {
    updateControlsOffset(true);
    applyFullscreenChatMode();
  } else {
    restoreNormalChat();
  }
});

// Chat mode menu options click
chatModeOptions.forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    const mode = opt.dataset.mode;
    setChatMode(mode);
    if (chatModeMenu) chatModeMenu.classList.remove('active');
  });
});

// Chat button behavior
function toggleChat() {
  if (document.fullscreenElement) {
    if (chatModeMenu) chatModeMenu.classList.toggle('active');
  } else {
    chatPanel.classList.toggle('collapsed');
  }
}

btnChatToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleChat();
});

btnChatToggle.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (chatModeMenu) chatModeMenu.classList.toggle('active');
});

document.addEventListener('click', (e) => {
  if (chatModeMenu && !chatModeMenu.contains(e.target) && e.target !== btnChatToggle && !btnChatToggle.contains(e.target)) {
    chatModeMenu.classList.remove('active');
  }
});

btnCloseChat.addEventListener('click', toggleChat);

btnMinimizeChat.addEventListener('click', () => {
  chatPanel.classList.toggle('hud-minimized');
});

// Ambient Reply Bar management
let isReplyBarOpen = false;
let ambientReplyIdleTimer = null;
let ambientReplyTypingTimer = null;

function updateAmbientInputUI() {
  const len = chatInput.value.length;
  if (ambientReturnGlyph) {
    ambientReturnGlyph.classList.toggle('has-text', len > 0);
  }
  if (ambientCharCounter) {
    if (len >= 170) {
      ambientCharCounter.textContent = `${len}/200`;
      ambientCharCounter.classList.add('visible');
      ambientCharCounter.classList.toggle('limit-reached', len >= 200);
    } else {
      ambientCharCounter.classList.remove('visible', 'limit-reached');
    }
  }
}

function resetAmbientReplyTypingTimer() {
  clearTimeout(ambientReplyTypingTimer);
  if (!isReplyBarOpen) return;
  chatPanel.classList.remove('ambient-reply-idle');

  ambientReplyTypingTimer = setTimeout(() => {
    if (isReplyBarOpen) {
      chatPanel.classList.add('ambient-reply-idle');
    }
  }, 3000);
}

function showAmbientReplyBar() {
  if (!document.fullscreenElement || currentChatMode !== 'ambient') return;
  isReplyBarOpen = true;
  chatPanel.classList.remove('ambient-reply-idle', 'ambient-reply-closing');
  chatPanel.classList.add('ambient-reply-active');
  chatInput.placeholder = "Message...";
  chatInput.value = '';
  updateAmbientInputUI();
  chatInput.focus();
  pauseAmbientFadeTimers();
  resetAmbientReplyIdleTimer();
  resetAmbientReplyTypingTimer();
}

function hideAmbientReplyBar() {
  if (!isReplyBarOpen) return;
  isReplyBarOpen = false;
  clearTimeout(ambientReplyIdleTimer);
  clearTimeout(ambientReplyTypingTimer);
  chatPanel.classList.remove('ambient-reply-idle');
  chatInput.blur();

  chatPanel.classList.add('ambient-reply-closing');
  setTimeout(() => {
    chatPanel.classList.remove('ambient-reply-active', 'ambient-reply-closing');
    chatInput.value = '';
    chatInput.placeholder = "Send a message...";
    updateAmbientInputUI();
    resumeAmbientFadeTimers();
  }, 100);
}

function resetAmbientReplyIdleTimer() {
  clearTimeout(ambientReplyIdleTimer);
  if (!isReplyBarOpen) return;
  if (!chatInput.value.trim()) {
    ambientReplyIdleTimer = setTimeout(() => {
      if (isReplyBarOpen && !chatInput.value.trim()) {
        hideAmbientReplyBar();
      }
    }, 10000);
  }
}

chatInput.addEventListener('input', () => {
  if (isReplyBarOpen) {
    updateAmbientInputUI();
    resetAmbientReplyIdleTimer();
    resetAmbientReplyTypingTimer();
  }
});

// Ambient message fade & hover pause
function fadeOutChip(chip) {
  if (!chip || chip.classList.contains('ambient-faded') || chip.classList.contains('ambient-chip-exiting')) return;
  chip.classList.add('ambient-chip-exiting');
  setTimeout(() => {
    chip.classList.remove('ambient-chip-exiting');
    chip.classList.add('ambient-faded');
  }, 180);
}

function pauseAmbientFadeTimers() {
  const chips = Array.from(chatFeed.querySelectorAll('.ambient-chip:not(.ambient-faded):not(.ambient-chip-exiting)'));
  const now = Date.now();
  for (const chip of chips) {
    if (chip._fadeTimer) {
      clearTimeout(chip._fadeTimer);
      chip._fadeTimer = null;
      const elapsed = now - (chip._timerStart || now);
      chip._remaining = Math.max(500, (chip._remaining || 6000) - elapsed);
    }
  }
}

function resumeAmbientFadeTimers() {
  const chips = Array.from(chatFeed.querySelectorAll('.ambient-chip:not(.ambient-faded):not(.ambient-chip-exiting)'));
  const now = Date.now();
  for (const chip of chips) {
    if (!chip._fadeTimer && !chip._isHovered) {
      chip._timerStart = now;
      chip._fadeTimer = setTimeout(() => {
        fadeOutChip(chip);
      }, chip._remaining || 6000);
    }
  }
}

function handleAmbientMessage(el) {
  if (!document.fullscreenElement || currentChatMode !== 'ambient') return;

  el.classList.add('ambient-chip');
  el.classList.remove('ambient-faded');
  el._remaining = 6000;
  el._timerStart = Date.now();
  el._isHovered = false;

  if (isReplyBarOpen) {
    el._fadeTimer = null;
  } else {
    el._fadeTimer = setTimeout(() => {
      fadeOutChip(el);
    }, el._remaining);
  }

  // Enforce max 5 visible ambient messages; extra older ones fade out early
  const visible = Array.from(chatFeed.querySelectorAll('.ambient-chip:not(.ambient-faded):not(.ambient-chip-exiting)'));
  if (visible.length > 5) {
    const toHide = visible.slice(0, visible.length - 5);
    toHide.forEach(node => {
      clearTimeout(node._fadeTimer);
      fadeOutChip(node);
    });
  }
}

appContainer.addEventListener('mousemove', (e) => {
  if (!document.fullscreenElement || currentChatMode !== 'ambient' || isReplyBarOpen) return;
  const visible = Array.from(chatFeed.querySelectorAll('.ambient-chip:not(.ambient-faded):not(.ambient-chip-exiting)'));

  for (const node of visible) {
    const rect = node.getBoundingClientRect();
    const isInside = (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);

    if (isInside) {
      if (!node._isHovered) {
        node._isHovered = true;
        clearTimeout(node._fadeTimer);
        node._fadeTimer = null;
        const elapsed = Date.now() - (node._timerStart || Date.now());
        node._remaining = Math.max(500, (node._remaining || 6000) - elapsed);
      }
    } else {
      if (node._isHovered) {
        node._isHovered = false;
        node._timerStart = Date.now();
        node._fadeTimer = setTimeout(() => {
          fadeOutChip(node);
        }, node._remaining);
      }
    }
  }
});

// Panel 8s Auto-Collapse
function resetPanelIdleTimer() {
  if (!document.fullscreenElement || currentChatMode !== 'panel') return;
  chatPanel.classList.remove('hud-minimized');
  clearTimeout(panelIdleTimer);

  panelIdleTimer = setTimeout(() => {
    if (document.fullscreenElement && currentChatMode === 'panel' && !chatPanel.matches(':hover') && !chatPanel.contains(document.activeElement)) {
      chatPanel.classList.add('hud-minimized');
    }
  }, 8000);
}

chatPanel.addEventListener('mousemove', resetPanelIdleTimer);
chatPanel.addEventListener('mouseenter', resetPanelIdleTimer);
chatPanel.addEventListener('focusin', resetPanelIdleTimer);

// Fullscreen HUD Dragging
let isDraggingHUD = false;
let hudStartX = 0;
let hudStartY = 0;
let hudInitLeft = 0;
let hudInitTop = 0;

hudDragHandle.addEventListener('pointerdown', (e) => {
  if (!document.fullscreenElement || currentChatMode !== 'panel') return;
  isDraggingHUD = true;
  hudDragHandle.setPointerCapture(e.pointerId);

  const rect = chatPanel.getBoundingClientRect();
  hudStartX = e.clientX;
  hudStartY = e.clientY;
  hudInitLeft = rect.left;
  hudInitTop = rect.top;
});

window.addEventListener('pointermove', (e) => {
  if (!isDraggingHUD || !document.fullscreenElement) return;
  const dx = e.clientX - hudStartX;
  const dy = e.clientY - hudStartY;

  const newLeft = Math.max(10, Math.min(window.innerWidth - chatPanel.offsetWidth - 10, hudInitLeft + dx));
  const newTop = Math.max(10, Math.min(window.innerHeight - chatPanel.offsetHeight - 10, hudInitTop + dy));

  chatPanel.style.left = `${newLeft}px`;
  chatPanel.style.top = `${newTop}px`;
  chatPanel.style.right = 'auto';
  chatPanel.style.bottom = 'auto';
});

window.addEventListener('pointerup', (e) => {
  if (isDraggingHUD) {
    isDraggingHUD = false;
    if (e.pointerId && hudDragHandle.hasPointerCapture(e.pointerId)) {
      hudDragHandle.releasePointerCapture(e.pointerId);
    }
  }
});

// Initialize active mode menu
updateModeMenuUI();

// ==========================================================================
// Chat Scroll & Message Feed
// ==========================================================================
function isUserScrolledUp() {
  return (chatFeed.scrollHeight - chatFeed.scrollTop - chatFeed.clientHeight) > 50;
}

chatFeed.addEventListener('scroll', () => {
  if (!isUserScrolledUp()) {
    newMessagesPill.classList.remove('visible');
  }
});

newMessagesPill.addEventListener('click', () => {
  chatFeed.scrollTop = chatFeed.scrollHeight;
  newMessagesPill.classList.remove('visible');
});

let lastMessageInfo = null;

function appendChatMessage(data) {
  const wasScrolledUp = isUserScrolledUp();
  const div = document.createElement('div');
  div.className = `msg ${data.username === username ? 'own-msg' : ''}`;

  const isGrouped = !!(
    lastMessageInfo &&
    lastMessageInfo.username === data.username &&
    (data.timestamp - lastMessageInfo.timestamp) <= 20000
  );
  lastMessageInfo = { username: data.username, timestamp: data.timestamp };

  if (isGrouped) {
    div.classList.add('msg-grouped');
  }

  const userColor = getUserColor(data.username);
  div.style.setProperty('--user-color', userColor);

  const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `
    <div class="msg-header">
      <span class="user-name" style="color: var(--user-color);">${escapeHtml(data.username)}</span>
      <span class="time-stamp">${timeStr}</span>
    </div>
    <div class="msg-body">${escapeHtml(data.text)}</div>
  `;

  chatFeed.appendChild(div);

  if (document.fullscreenElement) {
    if (currentChatMode === 'ambient') {
      handleAmbientMessage(div);
    } else if (currentChatMode === 'off') {
      div.classList.add('ambient-faded');
      if (chatUnreadDot) chatUnreadDot.style.display = 'block';
    } else if (currentChatMode === 'panel') {
      resetPanelIdleTimer();
    }
  }

  if (wasScrolledUp && data.username !== username && (!document.fullscreenElement || currentChatMode === 'panel')) {
    newMessagesPill.classList.add('visible');
  } else if (!document.fullscreenElement || currentChatMode === 'panel') {
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }
}

function appendSystemMessage(text) {
  lastMessageInfo = null;
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  chatFeed.appendChild(div);

  if (document.fullscreenElement) {
    if (currentChatMode === 'ambient') {
      handleAmbientMessage(div);
    } else if (currentChatMode === 'off') {
      div.classList.add('ambient-faded');
    }
  }

  chatFeed.scrollTop = chatFeed.scrollHeight;
}

sendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (text && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', text, username, timestamp: Date.now() }));
    chatInput.value = '';
  }
});

chatInput.addEventListener('keydown', (e) => {
  if (isReplyBarOpen) {
    resetAmbientReplyTypingTimer();
  }
  e.stopPropagation();
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (document.fullscreenElement && currentChatMode === 'ambient') {
      const text = chatInput.value.trim();
      if (text) {
        sendBtn.click();
        localStorage.setItem('cinesync_ambient_hint_done', 'true');
        updateAmbientHintUI();
      }
      hideAmbientReplyBar();
      return;
    }
    sendBtn.click();
  }
});

// Reactions
reactionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.textContent.trim();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'REACTION', emoji }));
    }
  });
});

function spawnFloatingEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  const drift = (Math.random() - 0.5) * 60;
  el.style.setProperty('--drift', `${drift}px`);
  playerWrapper.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

// ==========================================================================
// WebSocket Synchronization
// ==========================================================================
function initWebSocket() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'USER_JOIN', username }));
    ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  };

  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);

      if (data.type === 'SYNC_ACTION') {
        isRemoteUpdate = true;
        const drift = Math.abs(player.currentTime - data.payload.currentTime);

        if (drift > 0.5 || data.payload.action === 'SEEK') {
          player.currentTime = data.payload.currentTime;
        }

        if (data.payload.action === 'PLAY' && player.paused) {
          player.play().catch(showAutoplayOverlay);
        } else if (data.payload.action === 'PAUSE' && !player.paused) {
          player.pause();
        }

        setTimeout(() => { isRemoteUpdate = false; }, 200);
      }
      else if (data.type === 'CHAT_MESSAGE') {
        appendChatMessage(data);
      }
      else if (data.type === 'SYSTEM_MESSAGE') {
        appendSystemMessage(data.text);
      }
      else if (data.type === 'USER_COUNT') {
        if (userCountBadge) userCountBadge.textContent = `${data.count} online`;
      }
      else if (data.type === 'USER_LIST') {
        if (Array.isArray(data.users)) {
          activeParticipants = data.users;
          renderParticipantsList();
        }
      }
      else if (data.type === 'REACTION') {
        spawnFloatingEmoji(data.emoji);
      }
      else if (data.type === 'MEDIA_CHANGING') {
        player.pause();
        if (mediaChangingOverlay) mediaChangingOverlay.style.display = 'flex';
      }
      else if (data.type === 'MEDIA_READY') {
        window.location.reload(true);
      }
    } catch (e) {
      console.error('Socket parse error', e);
    }
  };
}

function broadcastSync(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN || isRemoteUpdate) return;
  ws.send(JSON.stringify({
    type: 'SYNC_ACTION',
    payload: { action, currentTime: player.currentTime }
  }));
}

// ==========================================================================
// Keyboard Shortcuts
// ==========================================================================
document.addEventListener('keydown', (e) => {
  // Shortcut: pressing Enter opens the reply bar in fullscreen ambient mode
  if (document.fullscreenElement && currentChatMode === 'ambient' && !isReplyBarOpen) {
    if (e.code === 'Enter' || e.key === 'Enter') {
      if (!e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        const target = e.target;
        const active = document.activeElement;

        const isTargetInputLike = target && (
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.isContentEditable ||
          target.closest('[contenteditable="true"]') ||
          target.closest('.modal') ||
          target.closest('#joinModal')
        );

        const isActiveInputLike = active && (
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) ||
          active.isContentEditable ||
          active.closest('[contenteditable="true"]') ||
          active.closest('.modal') ||
          active.closest('#joinModal')
        );

        if (!isTargetInputLike && !isActiveInputLike) {
          if (active && (
            active.tagName === 'BUTTON' ||
            active.classList.contains('scrubber-container') ||
            active.id === 'scrubber' ||
            active.closest('.scrubber-container') ||
            active.getAttribute('role') === 'button' ||
            active.getAttribute('role') === 'slider'
          )) {
            active.blur();
          }
          e.preventDefault();
          showAmbientReplyBar();
          return;
        }
      }
    }
  }

  // If typing in any input/textarea, ignore all global shortcuts so player is never controlled
  if (document.activeElement && (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) ||
    document.activeElement.isContentEditable
  )) {
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      handlePlayPause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      handleSkipBack();
      break;
    case 'ArrowRight':
      e.preventDefault();
      handleSkipFwd();
      break;
    case 'KeyM':
      e.preventDefault();
      handleMuteToggle();
      break;
    case 'KeyC':
      e.preventDefault();
      handleCCToggle();
      break;
    case 'KeyF':
      e.preventDefault();
      handleFullscreenToggle();
      break;
    case 'KeyT':
      e.preventDefault();
      toggleChat();
      break;
  }
});
