// ==========================================================================
// CineSync Setup Controller
// ==========================================================================

const filepathInput = document.getElementById('filepath-input');
const inspectBtn = document.getElementById('inspect-btn');
const inspectError = document.getElementById('inspectError');
const setupStep1 = document.getElementById('setup-step-1');
const setupStep2 = document.getElementById('setup-step-2');

const stepIndicator1 = document.getElementById('stepIndicator1');
const stepIndicator2 = document.getElementById('stepIndicator2');
const stepIndicator3 = document.getElementById('stepIndicator3');

const videoCodecBadge = document.getElementById('videoCodecBadge');
const btnChangeFile = document.getElementById('btnChangeFile');
const audioSelect = document.getElementById('audio-select');
const subSelect = document.getElementById('sub-select');
const externalSubInput = document.getElementById('external-sub-input');
const prepareError = document.getElementById('prepareError');

const startBtn = document.getElementById('start-btn');
const progressContainer = document.getElementById('progress-container');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const progressBarBg = document.getElementById('progressBarBg');

const recentFilesContainer = document.getElementById('recentFilesContainer');
const recentFilesList = document.getElementById('recentFilesList');

let ws = null;
let previousSubVal = 'none';

// ==========================================================================
// Recent Files Handling (localStorage)
// ==========================================================================
function getRecentFiles() {
  try {
    return JSON.parse(localStorage.getItem('cinesync_recent_files')) || [];
  } catch (e) {
    return [];
  }
}

function saveRecentFile(path) {
  if (!path) return;
  let files = getRecentFiles().filter(f => f !== path);
  files.unshift(path);
  if (files.length > 5) files = files.slice(0, 5);
  localStorage.setItem('cinesync_recent_files', JSON.stringify(files));
  renderRecentFiles();
}

function removeRecentFile(path) {
  let files = getRecentFiles().filter(f => f !== path);
  localStorage.setItem('cinesync_recent_files', JSON.stringify(files));
  renderRecentFiles();
}

function renderRecentFiles() {
  const files = getRecentFiles();
  if (files.length === 0) {
    recentFilesContainer.style.display = 'none';
    return;
  }
  recentFilesContainer.style.display = 'flex';
  recentFilesList.innerHTML = '';

  files.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'recent-file-chip';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'recent-file-name';
    nameSpan.textContent = f;
    nameSpan.title = f;
    nameSpan.addEventListener('click', () => {
      filepathInput.value = f;
      inspectError.style.display = 'none';
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'recent-file-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRecentFile(f);
    });

    chip.appendChild(nameSpan);
    chip.appendChild(removeBtn);
    recentFilesList.appendChild(chip);
  });
}

renderRecentFiles();

// ==========================================================================
// Step 1: Inspect Media
// ==========================================================================
inspectBtn.addEventListener('click', async () => {
  const filePath = filepathInput.value.trim();
  if (!filePath) {
    inspectError.textContent = 'Please enter an absolute file path';
    inspectError.style.display = 'block';
    return;
  }

  inspectError.style.display = 'none';
  inspectBtn.disabled = true;
  inspectBtn.textContent = 'Inspecting...';

  try {
    const res = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to inspect media file');
    }

    saveRecentFile(filePath);

    // Populate track selectors
    videoCodecBadge.textContent = data.videoCodec || 'Unknown';

    if (data.audio && data.audio.length > 0) {
      audioSelect.innerHTML = data.audio.map(a => `<option value="${a.index}">${escapeHtml(a.label)}</option>`).join('');
    } else {
      audioSelect.innerHTML = `<option value="1">Default audio</option>`;
    }

    let subOptions = `<option value="none">None</option>`;
    if (data.subtitle && data.subtitle.length > 0) {
      subOptions += data.subtitle.map(s => `<option value="${s.index}">${escapeHtml(s.label)}</option>`).join('');
    }
    subSelect.innerHTML = subOptions;

    // Switch Stepper
    stepIndicator1.classList.remove('active');
    stepIndicator1.classList.add('completed');
    stepIndicator2.classList.add('active');

    setupStep1.style.display = 'none';
    setupStep2.style.display = 'block';

    initProgressWebSocket();
  } catch (err) {
    inspectError.textContent = err.message || 'Error inspecting file. Verify the path exists.';
    inspectError.style.display = 'block';
  } finally {
    inspectBtn.disabled = false;
    inspectBtn.textContent = 'Inspect Media';
  }
});

btnChangeFile.addEventListener('click', () => {
  setupStep2.style.display = 'none';
  setupStep1.style.display = 'block';

  stepIndicator2.classList.remove('active');
  stepIndicator1.classList.remove('completed');
  stepIndicator1.classList.add('active');
});

// ==========================================================================
// Step 2: Track Selection & External Subtitles
// ==========================================================================
externalSubInput.addEventListener('input', () => {
  const val = externalSubInput.value.trim();
  if (val.length > 0) {
    if (subSelect.value !== 'external') {
      previousSubVal = subSelect.value;
    }
    let extOpt = subSelect.querySelector('option[value="external"]');
    if (!extOpt) {
      extOpt = document.createElement('option');
      extOpt.value = 'external';
      extOpt.textContent = 'Using External Subtitle';
      subSelect.prepend(extOpt);
    }
    subSelect.value = 'external';
    subSelect.disabled = true;
  } else {
    subSelect.disabled = false;
    const extOpt = subSelect.querySelector('option[value="external"]');
    if (extOpt) extOpt.remove();
    subSelect.value = previousSubVal || 'none';
  }
});

// ==========================================================================
// Step 3: Start Party & Progress
// ==========================================================================
startBtn.addEventListener('click', async () => {
  const filePath = filepathInput.value.trim();
  const externalSubPath = externalSubInput.value.trim();

  prepareError.style.display = 'none';
  startBtn.disabled = true;

  stepIndicator2.classList.remove('active');
  stepIndicator2.classList.add('completed');
  stepIndicator3.classList.add('active');

  progressContainer.style.display = 'block';
  progressBarBg.classList.add('indeterminate');
  progressBar.style.width = '0%';
  progressText.textContent = 'Preparing pipeline...';

  try {
    const res = await fetch('/api/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath,
        audioIndex: audioSelect.value,
        subIndex: subSelect.value,
        externalSubPath: externalSubPath || undefined
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to start media pipeline');
    }
  } catch (err) {
    prepareError.textContent = err.message || 'Transcode preparation failed';
    prepareError.style.display = 'block';
    startBtn.disabled = false;
    progressContainer.style.display = 'none';

    stepIndicator3.classList.remove('active');
    stepIndicator2.classList.add('active');
  }
});

// ==========================================================================
// WebSocket Progress Listener
// ==========================================================================
function initProgressWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'TRANSCODE_PROGRESS') {
        progressBarBg.classList.remove('indeterminate');
        const percent = Math.min(100, Math.max(0, Math.round(data.percent || 0)));
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `Processing: ${percent}%`;
      } else if (data.type === 'TRANSCODE_COMPLETE' || data.type === 'MEDIA_READY') {
        progressBarBg.classList.remove('indeterminate');
        progressBar.style.width = '100%';
        progressText.textContent = 'Complete! Loading room...';
        setTimeout(() => {
          window.location.href = '/watch.html';
        }, 500);
      }
    } catch (e) {
      console.error('Socket message parse error', e);
    }
  };
}

// ==========================================================================
// File Browser (lists folders on the host machine via /api/browse)
// ==========================================================================
const fileBrowser = document.getElementById('fileBrowser');
const fbTitle = document.getElementById('fbTitle');
const fbCloseBtn = document.getElementById('fbCloseBtn');
const fbPlaces = document.getElementById('fbPlaces');
const fbUpBtn = document.getElementById('fbUpBtn');
const fbPath = document.getElementById('fbPath');
const fbFilter = document.getElementById('fbFilter');
const fbList = document.getElementById('fbList');
const fbFooter = document.getElementById('fbFooter');

const ICON_FOLDER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
const ICON_FILM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>';
const ICON_TEXT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';

const fbState = {
  kind: 'video',
  path: null,
  parent: null,
  entries: [],
  onPick: null,
  returnFocus: null,
  requestId: 0
};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

function dirnameOf(p) {
  const trimmed = (p || '').trim();
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return null;
  if (idx === 0) return trimmed[0];
  return trimmed.slice(0, idx);
}

function formatSize(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function openFileBrowser({ kind, startDir, onPick, returnFocus }) {
  fbState.kind = kind;
  fbState.onPick = onPick;
  fbState.returnFocus = returnFocus || null;
  fbTitle.textContent = kind === 'subtitle' ? 'Choose a subtitle file' : 'Choose a movie';
  fileBrowser.hidden = false;
  document.body.style.overflow = 'hidden';
  loadDirectory(startDir || storageGet(`cinesync_browse_dir_${kind}`) || null, true);
}

function closeFileBrowser() {
  fileBrowser.hidden = true;
  document.body.style.overflow = '';
  fbState.requestId++;
  if (fbState.returnFocus) fbState.returnFocus.focus();
}

async function loadDirectory(dir, fallbackToHome = false) {
  const requestId = ++fbState.requestId;
  fbFilter.value = '';
  fbList.innerHTML = '<div class="fb-empty">Loading…</div>';

  const params = new URLSearchParams({ kind: fbState.kind });
  if (dir) params.set('dir', dir);

  let data;
  try {
    const res = await fetch(`/api/browse?${params}`);
    data = await res.json();
    if (requestId !== fbState.requestId) return;
    if (!res.ok) {
      if (fallbackToHome && dir && res.status !== 403) return loadDirectory(null, false);
      throw new Error(data.error || 'Could not open folder');
    }
  } catch (err) {
    if (requestId !== fbState.requestId) return;
    fbList.innerHTML = `<div class="fb-empty is-error">${escapeHtml(err.message)}</div>`;
    fbFooter.textContent = 'You can still paste the full path into the field instead.';
    return;
  }

  fbState.path = data.path;
  fbState.parent = data.parent;
  fbState.entries = data.entries;
  storageSet(`cinesync_browse_dir_${fbState.kind}`, data.path);

  // The container is RTL so long paths truncate on the left; isolate the text so it still reads LTR.
  const pathText = document.createElement('bdi');
  pathText.dir = 'ltr';
  pathText.textContent = data.path;
  fbPath.replaceChildren(pathText);
  fbPath.title = data.path;
  fbUpBtn.disabled = !data.parent;
  renderPlaces(data.places);
  renderEntries();
  fbFilter.focus();
}

function renderPlaces(places) {
  fbPlaces.innerHTML = '';
  places.forEach(place => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fb-place' + (place.path === fbState.path ? ' active' : '');
    btn.textContent = place.label;
    btn.title = place.path;
    btn.addEventListener('click', () => loadDirectory(place.path));
    fbPlaces.appendChild(btn);
  });
}

function renderEntries() {
  const query = fbFilter.value.trim().toLowerCase();
  const visible = query
    ? fbState.entries.filter(e => e.name.toLowerCase().includes(query))
    : fbState.entries;

  fbList.innerHTML = '';
  if (visible.length === 0) {
    const what = fbState.kind === 'subtitle' ? 'subtitle files' : 'video files';
    fbList.innerHTML = `<div class="fb-empty">${query ? 'Nothing matches that filter' : `No folders or ${what} here`}</div>`;
  }

  visible.forEach(entry => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'fb-item' + (entry.type === 'file' ? ' is-file' : '');
    item.setAttribute('role', 'option');
    item.title = entry.path;
    const icon = entry.type === 'dir' ? ICON_FOLDER : (fbState.kind === 'subtitle' ? ICON_TEXT : ICON_FILM);
    item.innerHTML = `${icon}<span class="fb-item-name">${escapeHtml(entry.name)}</span>` +
      (entry.type === 'file' ? `<span class="fb-item-meta">${formatSize(entry.size)}</span>` : '');
    item.addEventListener('click', () => {
      if (entry.type === 'dir') {
        loadDirectory(entry.path);
      } else {
        const pick = fbState.onPick;
        closeFileBrowser();
        if (pick) pick(entry.path);
      }
    });
    fbList.appendChild(item);
  });

  const files = fbState.entries.filter(e => e.type === 'file').length;
  const dirs = fbState.entries.length - files;
  fbFooter.textContent = `${dirs} folder${dirs === 1 ? '' : 's'} · ${files} ${fbState.kind === 'subtitle' ? 'subtitle' : 'video'} file${files === 1 ? '' : 's'}`;
}

fbFilter.addEventListener('input', renderEntries);
fbCloseBtn.addEventListener('click', closeFileBrowser);
fbUpBtn.addEventListener('click', () => { if (fbState.parent) loadDirectory(fbState.parent); });
fileBrowser.addEventListener('mousedown', (e) => { if (e.target === fileBrowser) closeFileBrowser(); });

fileBrowser.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeFileBrowser();
    return;
  }

  const items = Array.from(fbList.querySelectorAll('.fb-item'));
  const index = items.indexOf(document.activeElement);

  if (e.key === 'Backspace' && (document.activeElement !== fbFilter || fbFilter.value === '')) {
    e.preventDefault();
    if (fbState.parent) loadDirectory(fbState.parent);
  } else if (e.key === 'ArrowDown' && items.length) {
    e.preventDefault();
    items[Math.min(index + 1, items.length - 1)].focus();
  } else if (e.key === 'ArrowUp' && items.length) {
    e.preventDefault();
    if (index <= 0) fbFilter.focus();
    else items[index - 1].focus();
  } else if (e.key === 'Enter' && document.activeElement === fbFilter && items.length) {
    e.preventDefault();
    items[0].click();
  }
});

document.getElementById('browseMovieBtn').addEventListener('click', (e) => {
  openFileBrowser({
    kind: 'video',
    startDir: dirnameOf(filepathInput.value),
    returnFocus: e.currentTarget,
    onPick: (filePath) => {
      filepathInput.value = filePath;
      inspectError.style.display = 'none';
      inspectBtn.click();
    }
  });
});

document.getElementById('browseSubBtn').addEventListener('click', (e) => {
  openFileBrowser({
    kind: 'subtitle',
    startDir: dirnameOf(externalSubInput.value) || dirnameOf(filepathInput.value),
    returnFocus: e.currentTarget,
    onPick: (filePath) => {
      externalSubInput.value = filePath;
      externalSubInput.dispatchEvent(new Event('input'));
    }
  });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
