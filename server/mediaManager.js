const express = require('express');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { getWss } = require('./syncManager');
const { titleFromPath, saveMovieInfo, loadMovieInfo } = require('./movieInfo');
const { requireHost } = require('./host');
const permissions = require('./permissions');

const router = express.Router();
const MEDIA_DIR = path.join(__dirname, '..', 'media');
// Legacy single-file output (movies prepared before streaming); still served.
const MOVIE_PATH = path.join(MEDIA_DIR, 'movie.mp4');
const SUBTITLE_PATH = path.join(MEDIA_DIR, 'subtitles.vtt');
// Streaming output: an HLS playlist plus ~6s chunks, playable while it's written.
const STREAM_DIR = path.join(MEDIA_DIR, 'stream');
const PLAYLIST_PATH = path.join(STREAM_DIR, 'index.m3u8');
// The room opens once this many chunks exist (about 10 seconds of movie).
const READY_SEGMENTS = 2;

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/** fs helpers that never throw (and tolerate a partially-mocked fs in tests). */
function tryRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
function tryRemove(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

let appStateRef = null;
let movieInfo = loadMovieInfo(MEDIA_DIR);
// Streaming progress for the current movie.
let stream = { preparedSeconds: 0, complete: true };

// A playlist left without an end marker means preparing was interrupted (e.g. the
// server restarted). Close it so players treat what exists as the whole movie.
(function repairInterruptedStream() {
  const playlist = tryRead(PLAYLIST_PATH);
  if (playlist && !playlist.includes('#EXT-X-ENDLIST')) {
    try {
      fs.appendFileSync(PLAYLIST_PATH, '#EXT-X-ENDLIST\n');
    } catch {
      /* ignore */
    }
  }
})();

/** Which kind of prepared movie exists right now: 'hls', 'mp4' (legacy) or null. */
function movieSource() {
  if (fs.existsSync(PLAYLIST_PATH)) return 'hls';
  if (fs.existsSync(MOVIE_PATH)) return 'mp4';
  return null;
}

function countSegments() {
  const playlist = tryRead(PLAYLIST_PATH);
  return playlist ? (playlist.match(/#EXTINF/g) || []).length : 0;
}

// Inspect results by file path, so prepare knows codecs without probing again.
const probeCache = new Map();

/** "00:12:34.56" → 754.56 */
function timemarkToSeconds(mark) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(mark || ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function setAppState(state) {
  appStateRef = state;
}

function broadcast(message) {
  const wss = getWss();
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(payload);
  });
}

function handleInspect(filePath, res) {
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File not found' });
  }

  ffmpeg.ffprobe(filePath, (err, metadata) => {
    if (err) return res.status(500).json({ error: 'ffprobe failed', details: err.message });
    
    const duration = Number(metadata.format && metadata.format.duration);
    const result = { videoCodec: 'Unknown', duration: Number.isFinite(duration) ? duration : null, audio: [], subtitle: [] };
    
    const audioCodecs = {};
    metadata.streams.forEach(stream => {
      const label = (stream.tags?.language || 'Unknown') + ` (${stream.codec_name})`;
      if (stream.codec_type === 'video') {
        result.videoCodec = stream.codec_name;
      } else if (stream.codec_type === 'audio') {
        result.audio.push({ index: stream.index, label });
        audioCodecs[stream.index] = { codec: stream.codec_name, channels: stream.channels };
      } else if (stream.codec_type === 'subtitle') {
        result.subtitle.push({ index: stream.index, label });
      }
    });

    probeCache.set(filePath, { videoCodec: result.videoCodec, duration: result.duration, audioCodecs });
    res.json(result);
  });
}

router.get('/api/inspect', requireHost, (req, res) => {
  handleInspect(req.query.filePath, res);
});

router.post('/api/inspect', requireHost, (req, res) => {
  handleInspect(req.body.filePath, res);
});

const handlePrepare = (req, res) => {
  const { filePath, audioIndex, subIndex, externalSubPath, permissions: guestPermissions } = req.body;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File not found' });
  }

  // Track indexes are interpolated into ffmpeg options, so only accept plain stream numbers.
  const isStreamIndex = (v) => /^\d+$/.test(String(v));
  const hasAudio = audioIndex !== undefined && audioIndex !== null && audioIndex !== '' && audioIndex !== 'none';
  if (hasAudio && !isStreamIndex(audioIndex)) {
    return res.status(400).json({ error: 'Invalid audio track' });
  }
  if (subIndex !== undefined && !['none', 'external'].includes(subIndex) && !isStreamIndex(subIndex)) {
    return res.status(400).json({ error: 'Invalid subtitle track' });
  }

  const cleanExternalSub = (typeof externalSubPath === 'string' && externalSubPath.trim()) ? externalSubPath.trim() : null;

  if (cleanExternalSub && !fs.existsSync(cleanExternalSub)) {
    return res.status(400).json({ error: 'External subtitle file not found' });
  }

  res.json({ success: true, message: 'Processing started' });
  // The host picks what guests may do when creating the room.
  if (guestPermissions && typeof guestPermissions === 'object') {
    permissions.setPermissions(permissions.normalizePermissions(guestPermissions));
    broadcast({ type: 'PERMISSIONS', permissions: permissions.getPermissions(), by: null });
  }
  const probe = probeCache.get(filePath) || {};
  const preparingInfo = {
    title: titleFromPath(filePath),
    fileName: path.basename(filePath),
    duration: probe.duration || null
  };

  // Clear the previous movie (also frees its disk space).
  if (fs.existsSync(MOVIE_PATH)) fs.unlinkSync(MOVIE_PATH);
  if (fs.existsSync(SUBTITLE_PATH)) fs.unlinkSync(SUBTITLE_PATH);
  tryRemove(STREAM_DIR);
  try {
    fs.mkdirSync(STREAM_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
  stream = { preparedSeconds: 0, complete: false };

  // Subtitles run alongside the movie instead of before it, so they never delay the start.
  const subtitleJob = (input, options) =>
    ffmpeg(input)
      .outputOptions(options)
      .save(SUBTITLE_PATH)
      .on('end', () => broadcast({ type: 'SUBTITLES_READY' }))
      .on('error', (err) => console.error('Subtitle extraction failed:', err.message));

  if (cleanExternalSub && path.extname(cleanExternalSub).toLowerCase() === '.vtt') {
    try {
      fs.copyFileSync(cleanExternalSub, SUBTITLE_PATH);
    } catch (err) {
      console.error('Error copying external vtt file:', err.message);
    }
  } else if (cleanExternalSub) {
    subtitleJob(cleanExternalSub, ['-y', '-c:s webvtt']);
  } else if (subIndex !== 'none' && subIndex !== undefined && subIndex !== 'external') {
    subtitleJob(filePath, [`-map 0:${subIndex}`, '-c:s webvtt']);
  }

  // Audio: copy if it's already browser-friendly stereo AAC; otherwise convert with
  // the fast AAC coder (about twice as fast, and audio is the slow part).
  const source = probe.audioCodecs && hasAudio ? probe.audioCodecs[audioIndex] : null;
  const copyAudio = source && source.codec === 'aac' && source.channels <= 2;
  const audioOptions = !hasAudio
    ? ['-an']
    : copyAudio
      ? [`-map 0:${audioIndex}`, '-c:a copy']
      : [`-map 0:${audioIndex}`, '-c:a aac', '-aac_coder fast', '-b:a 192k', '-ac 2'];

  // Video is copied untouched. HEVC gets the "hvc1" tag Apple devices need.
  const videoOptions = ['-map 0:v:0', '-c:v copy'];
  if (probe.videoCodec === 'hevc') videoOptions.push('-tag:v hvc1');

  const cmd = ffmpeg(filePath)
    .outputOptions([
      ...videoOptions,
      ...audioOptions,
      '-f hls',
      '-hls_time 6',
      '-hls_playlist_type event',
      '-hls_segment_type fmp4',
      '-hls_fmp4_init_filename init.mp4',
      `-hls_segment_filename ${path.join(STREAM_DIR, 'seg_%05d.m4s')}`,
      '-hls_flags independent_segments'
    ])
    .save(PLAYLIST_PATH);

  let opened = false;
  const openRoom = () => {
    if (opened) return;
    opened = true;
    movieInfo = preparingInfo;
    saveMovieInfo(MEDIA_DIR, movieInfo);
    if (appStateRef) appStateRef.isPartyActive = true;
    broadcast({ type: 'MEDIA_READY' });
  };

  cmd.on('progress', (progress) => {
    const seconds = timemarkToSeconds(progress.timemark);
    if (seconds !== null) stream.preparedSeconds = seconds;
    const duration = preparingInfo.duration;
    const percent = duration && seconds !== null ? (seconds / duration) * 100 : progress.percent;
    broadcast({ type: 'TRANSCODE_PROGRESS', percent, seconds: stream.preparedSeconds, duration });
    // People can start watching as soon as the first chunks exist.
    if (!opened && countSegments() >= READY_SEGMENTS) openRoom();
  });

  cmd.on('end', () => {
    stream = { preparedSeconds: preparingInfo.duration || stream.preparedSeconds, complete: true };
    openRoom();
    broadcast({ type: 'TRANSCODE_COMPLETE' });
    broadcast({ type: 'STREAM_COMPLETE' });
  });

  cmd.on('error', (err) => {
    console.error('Transcode error:', err.message);
    // First line of ffmpeg's error is the useful summary; the rest is option-parsing noise.
    const summary = String(err.message || 'Unknown error').split('\n')[0].trim();
    broadcast({ type: 'TRANSCODE_ERROR', message: summary });
  });
};

router.post('/api/prepare', requireHost, handlePrepare);
router.post('/api/start-party', requireHost, handlePrepare);

router.get('/api/movie', (req, res) => {
  // Re-derive from the file name so title-cleanup improvements apply to movies
  // that were prepared before them.
  const active = !appStateRef || appStateRef.isPartyActive;
  const source = active ? movieSource() : null;
  const title = movieInfo && source ? titleFromPath(movieInfo.fileName || movieInfo.title) : null;
  res.json({
    title,
    source,
    duration: (movieInfo && movieInfo.duration) || null,
    // How far the movie is ready; while preparing, nobody can jump past this.
    preparedSeconds: stream.complete ? null : stream.preparedSeconds,
    complete: stream.complete
  });
});

/**
 * Parse a single HTTP Range header against a file size.
 * Returns { start, end } to serve, null if it can't be satisfied (→ 416),
 * or undefined if the header is unusable and the whole file should be sent.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').split(',')[0].trim());
  if (!match || (match[1] === '' && match[2] === '')) return undefined;

  if (match[1] === '') {
    // "bytes=-500" means the last 500 bytes.
    const suffix = parseInt(match[2], 10);
    if (suffix === 0 || size === 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = parseInt(match[1], 10);
  const end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
  if (start >= size || end < start) return null;
  return { start, end };
}

router.get('/video', (req, res) => {
  if (!fs.existsSync(MOVIE_PATH)) {
    return res.status(404).send('Movie not ready');
  }

  const fileSize = fs.statSync(MOVIE_PATH).size;
  const range = req.headers.range ? parseRange(req.headers.range, fileSize) : undefined;

  if (range === null) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    return res.end();
  }

  if (range) {
    const { start, end } = range;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(MOVIE_PATH, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(MOVIE_PATH).pipe(res);
  }
});

module.exports = { router, setAppState, parseRange, movieSource, timemarkToSeconds, MEDIA_DIR, MOVIE_PATH, STREAM_DIR };
