const express = require('express');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { getWss } = require('./syncManager');
const { titleFromPath, saveMovieInfo, loadMovieInfo } = require('./movieInfo');

const router = express.Router();
const MEDIA_DIR = path.join(__dirname, '..', 'media');
const MOVIE_PATH = path.join(MEDIA_DIR, 'movie.mp4');
const SUBTITLE_PATH = path.join(MEDIA_DIR, 'subtitles.vtt');

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

let appStateRef = null;
let movieInfo = loadMovieInfo(MEDIA_DIR);

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
    
    metadata.streams.forEach(stream => {
      const label = (stream.tags?.language || 'Unknown') + ` (${stream.codec_name})`;
      if (stream.codec_type === 'video') {
        result.videoCodec = stream.codec_name;
      } else if (stream.codec_type === 'audio') {
        result.audio.push({ index: stream.index, label });
      } else if (stream.codec_type === 'subtitle') {
        result.subtitle.push({ index: stream.index, label });
      }
    });

    res.json(result);
  });
}

router.get('/api/inspect', (req, res) => {
  handleInspect(req.query.filePath, res);
});

router.post('/api/inspect', (req, res) => {
  handleInspect(req.body.filePath, res);
});

const handlePrepare = (req, res) => {
  const { filePath, audioIndex, subIndex, externalSubPath } = req.body;
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
  const preparingInfo = { title: titleFromPath(filePath), fileName: path.basename(filePath) };

  if (fs.existsSync(MOVIE_PATH)) fs.unlinkSync(MOVIE_PATH);
  if (fs.existsSync(SUBTITLE_PATH)) fs.unlinkSync(SUBTITLE_PATH);

  const extractSubtitles = () => {
    return new Promise((resolve) => {
      if (cleanExternalSub) {
        const ext = path.extname(cleanExternalSub).toLowerCase();
        if (ext === '.vtt') {
          try {
            fs.copyFileSync(cleanExternalSub, SUBTITLE_PATH);
            resolve();
          } catch (err) {
            console.error('Error copying external vtt file:', err);
            resolve();
          }
        } else if (ext === '.srt') {
          ffmpeg(cleanExternalSub)
            .outputOptions(['-y', '-c:s webvtt'])
            .save(SUBTITLE_PATH)
            .on('end', () => resolve())
            .on('error', (err) => {
              console.error('Error converting srt to vtt:', err.message);
              resolve();
            });
        } else {
          ffmpeg(cleanExternalSub)
            .outputOptions(['-y', '-c:s webvtt'])
            .save(SUBTITLE_PATH)
            .on('end', () => resolve())
            .on('error', (err) => {
              console.error('Error converting external subtitle to vtt:', err.message);
              resolve();
            });
        }
      } else {
        if (subIndex === 'none' || subIndex === undefined || subIndex === 'external') return resolve();
        ffmpeg(filePath)
          .outputOptions([`-map 0:${subIndex}`, '-c:s webvtt'])
          .save(SUBTITLE_PATH)
          .on('end', () => resolve())
          .on('error', () => resolve());
      }
    });
  };

  extractSubtitles().then(() => {
    const audioOptions = hasAudio
      ? [`-map 0:${audioIndex}`, '-c:a aac', '-ac 2']
      : ['-an'];

    const cmd = ffmpeg(filePath)
      .outputOptions([
        '-map 0:v:0',
        ...audioOptions,
        '-c:v copy',
        '-movflags +faststart'
      ])
      .save(MOVIE_PATH);

    cmd.on('progress', (progress) => {
      broadcast({ type: 'TRANSCODE_PROGRESS', percent: progress.percent });
    });

    cmd.on('end', () => {
      movieInfo = preparingInfo;
      saveMovieInfo(MEDIA_DIR, movieInfo);
      if (appStateRef) {
        appStateRef.isPartyActive = true;
      }
      broadcast({ type: 'TRANSCODE_COMPLETE' });
      broadcast({ type: 'MEDIA_READY' });
    });
    
    cmd.on('error', (err) => {
      console.error('Transcode error:', err.message);
      // First line of ffmpeg's error is the useful summary; the rest is option-parsing noise.
      const summary = String(err.message || 'Unknown error').split('\n')[0].trim();
      broadcast({ type: 'TRANSCODE_ERROR', message: summary });
    });
  });
};

router.post('/api/prepare', handlePrepare);
router.post('/api/start-party', handlePrepare);

router.get('/api/movie', (req, res) => {
  // Re-derive from the file name so title-cleanup improvements apply to movies
  // that were prepared before them.
  const title = movieInfo ? titleFromPath(movieInfo.fileName || movieInfo.title) : null;
  res.json({ title });
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

module.exports = { router, setAppState, parseRange, MEDIA_DIR, MOVIE_PATH };
