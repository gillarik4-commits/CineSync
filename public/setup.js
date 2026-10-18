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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
