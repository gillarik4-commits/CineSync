'use strict';
/**
 * Unit tests for mediaManager.js
 *
 * Key Jest constraint: jest.mock() is hoisted to the top of the file by babel.
 * The factory function cannot reference variables declared in the outer scope
 * (unless prefixed with 'mock'). We use purely inline factories.
 *
 * jest.resetModules() is called in beforeEach, so each test gets a clean
 * require() of mediaManager with the freshly-configured fs/ffmpeg mocks.
 *
 * IMPORTANT: call setExists() and configure ffmpegFn BEFORE calling require('../server/mediaManager')
 * inside each test, because resetModules() clears the module registry and re-runs
 * the jest.mock() factory on the next require().
 */

// ── inline mock factories ──────────────────────────────────────────────────────

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
  readFileSync: jest.fn(() => {
    throw new Error('ENOENT');
  }),
  rmSync: jest.fn(),
  appendFileSync: jest.fn(),
  copyFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
}));

const mockClients = [];
jest.mock('../server/syncManager', () => ({
  getWss: () => ({ clients: mockClients }),
}));

const mockGpu = { value: { type: 'vaapi', device: '/dev/dri/renderD128', label: 'Intel GPU' } };
jest.mock('../server/hwaccel', () => ({
  detectHardwareEncoder: () => Promise.resolve(mockGpu.value),
}));

jest.mock('fluent-ffmpeg', () => {
  const factory = jest.fn();
  factory.ffprobe = jest.fn();
  return factory;
});

// ── post-hoist imports ─────────────────────────────────────────────────────────

const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');

const MEDIA_DIR = path.join(__dirname, '..', 'media');
const MOVIE_PATH = path.join(MEDIA_DIR, 'movie.mp4');
const PLAYLIST_PATH = path.join(MEDIA_DIR, 'stream', 'index.m3u8');
const SUBTITLE_PATH = path.join(MEDIA_DIR, 'subtitles.vtt');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Configure which paths existsSync returns true for.
 * Call this AFTER resetModules() / BEFORE require('../server/mediaManager').
 */
function setExists(paths) {
  const fs = jest.requireMock('fs');
  fs.existsSync.mockImplementation((p) => {
    if (p === MEDIA_DIR) return true; // let mkdirSync be skipped
    return paths.includes(p);
  });
}

/** Build a no-op ffmpeg instance that calls onEvent(event, cb) for each .on() call */
function makeFfmpegInst(onEvent) {
  const inst = {
    inputOptions: jest.fn().mockReturnThis(),
    outputOptions: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (event, cb) {
      if (onEvent) onEvent(event, cb);
      return this;
    }),
  };
  return inst;
}

/** Wire up a fresh mediaManager with an optional appState */
function buildApp(partyActive = false) {
  // NOTE: do NOT call resetModules() here — caller already did it in beforeEach.
  // Calling it here would undo the setExists() configuration.
  const mediaManager = require('../server/mediaManager');
  const appState = { isPartyActive: partyActive };
  mediaManager.setAppState(appState);

  const app = express();
  app.use(express.json());
  app.use('/', mediaManager.router);
  return { app, appState, mediaManager };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('mediaManager', () => {
  beforeEach(() => {
    // Reset module registry + clear mock state each test
    jest.resetModules();
    jest.clearAllMocks();

    // Re-apply default implementations after clearAllMocks
    setExists([]);

    const ffmpegFn = jest.requireMock('fluent-ffmpeg');
    ffmpegFn.mockImplementation(() => makeFfmpegInst(null));
    ffmpegFn.ffprobe = jest.fn();
  });

  // ── setAppState / transcode end ───────────────────────────────────────────

  describe('setAppState()', () => {
    test('sets isPartyActive=true when ffmpeg transcode ends', async () => {
      setExists(['/valid/movie.mkv']);

      let capturedEndCb = null;

      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.mockImplementation(() => {
        return makeFfmpegInst((event, cb) => {
          if (event === 'end') capturedEndCb = cb;
        });
      });

      const { app, appState } = buildApp(false);

      const res = await request(app)
        .post('/api/prepare')
        .send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Wait for subtitle promise to resolve + ffmpeg chain to be set up
      await new Promise((r) => setTimeout(r, 150));

      expect(capturedEndCb).toBeTruthy();
      capturedEndCb();
      await new Promise((r) => setTimeout(r, 30));

      expect(appState.isPartyActive).toBe(true);
    });
  });

  // ── GET /api/inspect ──────────────────────────────────────────────────────

  describe('GET /api/inspect', () => {
    test('returns 400 when filePath query param is absent', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/api/inspect');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/File not found/);
    });

    test('returns 400 when file does not exist on disk', async () => {
      // nothing in existsMap for /nonexistent/...
      const { app } = buildApp();
      const res = await request(app).get('/api/inspect?filePath=/nonexistent/file.mkv');
      expect(res.status).toBe(400);
    });

    test('returns 500 on ffprobe error', async () => {
      setExists(['/valid/movie.mkv']);
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.ffprobe = jest.fn((_p, cb) => cb(new Error('probe failed'), null));

      const { app } = buildApp();
      const res = await request(app).get('/api/inspect?filePath=/valid/movie.mkv');
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/ffprobe failed/);
    });

    test('returns 200 with codec and stream info', async () => {
      setExists(['/valid/movie.mkv']);
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.ffprobe = jest.fn((_p, cb) =>
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', index: 0 },
            { codec_type: 'audio', codec_name: 'aac', index: 1, tags: { language: 'eng' } },
            { codec_type: 'subtitle', codec_name: 'subrip', index: 2, tags: { language: 'fra' } },
          ],
        })
      );

      const { app } = buildApp();
      const res = await request(app).get('/api/inspect?filePath=/valid/movie.mkv');
      expect(res.status).toBe(200);
      expect(res.body.videoCodec).toBe('h264');
      expect(res.body.audio).toHaveLength(1);
      expect(res.body.audio[0].label).toContain('aac');
      expect(res.body.subtitle).toHaveLength(1);
      expect(res.body.subtitle[0].label).toContain('subrip');
    });
  });

  // ── POST /api/inspect ─────────────────────────────────────────────────────

  describe('POST /api/inspect', () => {
    test('returns 400 for empty body', async () => {
      const { app } = buildApp();
      const res = await request(app).post('/api/inspect').send({});
      expect(res.status).toBe(400);
    });

    test('returns 200 with codec info for valid body', async () => {
      setExists(['/valid/movie.mkv']);
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.ffprobe = jest.fn((_p, cb) =>
        cb(null, {
          streams: [{ codec_type: 'video', codec_name: 'hevc', index: 0 }],
        })
      );

      const { app } = buildApp();
      const res = await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      expect(res.status).toBe(200);
      expect(res.body.videoCodec).toBe('hevc');
    });
  });

  // ── POST /api/prepare ─────────────────────────────────────────────────────

  describe('POST /api/prepare', () => {
    test('returns 400 when filePath body field is absent', async () => {
      const { app } = buildApp();
      const res = await request(app).post('/api/prepare').send({ audioIndex: '1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/File not found/);
    });

    test('returns 400 when file does not exist on disk', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/api/prepare')
        .send({ filePath: '/nonexistent/file.mkv', audioIndex: '1' });
      expect(res.status).toBe(400);
    });

    test('removes existing movie.mp4 and subtitles.vtt before transcoding', async () => {
      setExists(['/valid/movie.mkv', MOVIE_PATH, SUBTITLE_PATH]);

      let callIndex = 0;
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.mockImplementation(() => {
        callIndex++;
        const ci = callIndex;
        // resolve subtitle extraction immediately; don't trigger main transcode end
        return makeFfmpegInst((event, cb) => {
          if (ci === 1 && event === 'end') setTimeout(cb, 0);
        });
      });

      const { app } = buildApp();
      await request(app)
        .post('/api/prepare')
        .send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none' });

      // Allow async prepare body to run
      await new Promise((r) => setTimeout(r, 150));

      const fs = jest.requireMock('fs');
      expect(fs.unlinkSync).toHaveBeenCalledWith(MOVIE_PATH);
      expect(fs.unlinkSync).toHaveBeenCalledWith(SUBTITLE_PATH);
    });

    test('does NOT set isPartyActive when ffmpeg emits error', async () => {
      setExists(['/valid/movie.mkv']);

      let capturedErrorCb = null;

      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.mockImplementation(() => {
        return makeFfmpegInst((event, cb) => {
          if (event === 'error') capturedErrorCb = cb;
        });
      });

      const { app, appState } = buildApp(false);

      await request(app)
        .post('/api/prepare')
        .send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none' });

      await new Promise((r) => setTimeout(r, 150));
      if (capturedErrorCb) capturedErrorCb(new Error('codec error'));
      await new Promise((r) => setTimeout(r, 30));

      expect(appState.isPartyActive).toBe(false);
    });

    /** POST /api/prepare and return the outputOptions passed to the main transcode */
    async function prepareAndGetOptions(body) {
      setExists(['/valid/movie.mkv']);
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      const instances = [];
      ffmpegFn.mockImplementation(() => {
        const inst = makeFfmpegInst(null);
        instances.push(inst);
        return inst;
      });
      const { app } = buildApp();
      const res = await request(app).post('/api/prepare').send({ filePath: '/valid/movie.mkv', subIndex: 'none', ...body });
      await new Promise((r) => setTimeout(r, 50));
      const main = instances[instances.length - 1];
      return { res, options: main ? main.outputOptions.mock.calls[0][0] : null };
    }

    test('maps the chosen audio stream and encodes it to stereo AAC', async () => {
      const { res, options } = await prepareAndGetOptions({ audioIndex: '2' });
      expect(res.status).toBe(200);
      expect(options).toEqual(expect.arrayContaining(['-map 0:v:0', '-map 0:2', '-c:a aac', '-ac 2']));
      expect(options).not.toContain('-an');
    });

    test.each(['none', undefined, ''])('audioIndex=%p transcodes video only (-an, no audio map)', async (audioIndex) => {
      const { res, options } = await prepareAndGetOptions({ audioIndex });
      expect(res.status).toBe(200);
      expect(options).toContain('-an');
      expect(options.some(o => /^-map 0:\d/.test(o) || o === '-map 0:none' || o === '-map 0:')).toBe(false);
    });

    test.each([
      [{ audioIndex: '1 -f null' }, /audio/],
      [{ audioIndex: 'abc' }, /audio/],
      [{ audioIndex: '1', subIndex: '0 -y /etc/x' }, /subtitle/]
    ])('rejects non-numeric track indexes %p', async (body, msg) => {
      const { res } = await prepareAndGetOptions(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(msg);
    });

    test('broadcasts TRANSCODE_ERROR with the first line of the ffmpeg error', async () => {
      const sent = [];
      mockClients.length = 0;
      mockClients.push({ readyState: 1, send: (m) => sent.push(JSON.parse(m)) });

      setExists(['/valid/movie.mkv']);
      let errorCb = null;
      jest.requireMock('fluent-ffmpeg').mockImplementation(() =>
        makeFfmpegInst((event, cb) => { if (event === 'error') errorCb = cb; })
      );
      const { app } = buildApp();
      await request(app).post('/api/prepare').send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none' });
      await new Promise((r) => setTimeout(r, 50));

      errorCb(new Error("ffmpeg exited with code 234: Stream map '' matches no streams.\nTo ignore this, add a trailing '?' to the map."));
      expect(sent).toContainEqual({ type: 'TRANSCODE_ERROR', message: "ffmpeg exited with code 234: Stream map '' matches no streams." });
      mockClients.length = 0;
    });

    test('/api/start-party alias returns 400 for invalid path (edge case 5 — retry path)', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/api/start-party')
        .send({ filePath: '/nonexistent/file.mkv', audioIndex: '1' });
      expect(res.status).toBe(400);
    });
  });

  // ── Host-only routes ──────────────────────────────────────────────────────

  describe('host-only routes', () => {
    const GUEST = { 'cf-connecting-ip': '203.0.113.7' };
    test.each([
      ['get', '/api/inspect?filePath=/valid/movie.mkv'],
      ['post', '/api/inspect'],
      ['post', '/api/prepare'],
      ['post', '/api/start-party']
    ])('%s %s is refused for guests', async (method, url) => {
      setExists(['/valid/movie.mkv']);
      const { app } = buildApp();
      const res = await request(app)[method](url).set(GUEST).send({ filePath: '/valid/movie.mkv', audioIndex: '1' });
      expect(res.status).toBe(403);
    });

    test('prepare applies the guest permissions the host picked', async () => {
      setExists(['/valid/movie.mkv']);
      const { app } = buildApp();
      await request(app)
        .post('/api/prepare')
        .send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none', permissions: { seek: false, junk: 1 } });
      const permissions = require('../server/permissions');
      expect(permissions.getPermissions()).toEqual({ playback: true, seek: false, chat: true, reactions: true });
    });
  });

  // ── GET /api/movie ────────────────────────────────────────────────────────

  describe('GET /api/movie', () => {
    test('reports nothing before any movie is prepared', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/api/movie');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: null, source: null });
    });

    test('returns the cleaned title and HLS source once a movie is ready', async () => {
      setExists(['/films/The.Matrix.1999.1080p.BluRay.mkv']);
      let endCb = null;
      jest.requireMock('fluent-ffmpeg').mockImplementation(() =>
        makeFfmpegInst((event, cb) => {
          if (event === 'end') endCb = cb;
        })
      );
      const { app } = buildApp();
      await request(app)
        .post('/api/prepare')
        .send({ filePath: '/films/The.Matrix.1999.1080p.BluRay.mkv', audioIndex: '1', subIndex: 'none' });
      await new Promise((r) => setTimeout(r, 50));
      setExists(['/films/The.Matrix.1999.1080p.BluRay.mkv', PLAYLIST_PATH]);
      endCb();

      const res = await request(app).get('/api/movie');
      expect(res.body).toMatchObject({ title: 'The Matrix (1999)', source: 'hls', complete: true });
    });

    test('a legacy single-file movie is still served as mp4', async () => {
      setExists([MOVIE_PATH]);
      const { app } = buildApp(true);
      const res = await request(app).get('/api/movie');
      expect(res.body.source).toBe('mp4');
    });
  });

  // ── Streaming pipeline ───────────────────────────────────────────────────

  describe('streaming pipeline', () => {
    function probeWith(streams, duration = 5400) {
      jest.requireMock('fluent-ffmpeg').ffprobe.mockImplementation((_file, cb) =>
        cb(null, { format: { duration }, streams })
      );
    }

    async function prepare(app, body) {
      const instances = [];
      jest.requireMock('fluent-ffmpeg').mockImplementation(() => {
        const handlers = {};
        const inst = makeFfmpegInst((event, cb) => {
          handlers[event] = cb;
        });
        inst.handlers = handlers;
        instances.push(inst);
        return inst;
      });
      const res = await request(app).post('/api/prepare').send({ filePath: '/valid/movie.mkv', subIndex: 'none', ...body });
      await new Promise((r) => setTimeout(r, 30));
      const main = instances[instances.length - 1];
      return { res, main, options: main.outputOptions.mock.calls[0][0], savedTo: main.save.mock.calls[0][0] };
    }

    test('writes an HLS playlist of fMP4 chunks, copying the video', async () => {
      setExists(['/valid/movie.mkv']);
      const { app } = buildApp();
      const { options, savedTo } = await prepare(app, { audioIndex: '1' });
      expect(savedTo).toBe(PLAYLIST_PATH);
      expect(options).toEqual(
        expect.arrayContaining(['-map 0:v:0', '-c:v copy', '-f hls', '-hls_playlist_type event', '-hls_segment_type fmp4'])
      );
      expect(options).not.toContain('-movflags +faststart');
    });

    test('converts audio with the fast AAC coder when it needs converting', async () => {
      setExists(['/valid/movie.mkv']);
      probeWith([
        { index: 0, codec_type: 'video', codec_name: 'hevc' },
        { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 6 }
      ]);
      const { app } = buildApp();
      await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      const { options } = await prepare(app, { audioIndex: '1' });
      expect(options).toEqual(expect.arrayContaining(['-map 0:1', '-c:a aac', '-aac_coder fast', '-ac 2']));
      expect(options).toContain('-tag:v hvc1');
    });

    test('copies audio that is already stereo AAC, and skips the HEVC tag for H.264', async () => {
      setExists(['/valid/movie.mkv']);
      probeWith([
        { index: 0, codec_type: 'video', codec_name: 'h264' },
        { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 }
      ]);
      const { app } = buildApp();
      await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      const { options } = await prepare(app, { audioIndex: '1' });
      expect(options).toEqual(expect.arrayContaining(['-map 0:1', '-c:a copy']));
      expect(options).not.toContain('-c:a aac');
      expect(options).not.toContain('-tag:v hvc1');
    });

    test('opens the room once the first chunks exist, before preparing finishes', async () => {
      setExists(['/valid/movie.mkv']);
      const { app, appState } = buildApp(false);
      const { main } = await prepare(app, { audioIndex: '1' });

      const fs = jest.requireMock('fs');
      fs.readFileSync.mockImplementation(() => '#EXTM3U\n#EXTINF:6,\nseg_00000.m4s\n');
      main.handlers.progress({ timemark: '00:00:06.00' });
      expect(appState.isPartyActive).toBe(false);

      fs.readFileSync.mockImplementation(() => '#EXTM3U\n#EXTINF:6,\na\n#EXTINF:6,\nb\n');
      main.handlers.progress({ timemark: '00:00:12.50' });
      expect(appState.isPartyActive).toBe(true);

      const res = await request(app).get('/api/movie');
      expect(res.body).toMatchObject({ preparedSeconds: 12.5, complete: false });
    });

    test('inspect says whether converting is recommended and which GPU would do it', async () => {
      setExists(['/valid/movie.mkv']);
      probeWith([{ index: 0, codec_type: 'video', codec_name: 'hevc', height: 800 }]);
      const { app } = buildApp();
      const res = await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      expect(res.body.compat).toEqual({ recommended: true, gpu: 'Intel GPU' });

      probeWith([{ index: 0, codec_type: 'video', codec_name: 'h264', height: 1080 }]);
      mockGpu.value = null;
      const res2 = await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      expect(res2.body.compat).toEqual({ recommended: false, gpu: null });
      mockGpu.value = { type: 'vaapi', device: '/dev/dri/renderD128', label: 'Intel GPU' };
    });

    test('play everywhere converts to H.264 on the GPU', async () => {
      setExists(['/valid/movie.mkv']);
      probeWith([
        { index: 0, codec_type: 'video', codec_name: 'hevc', height: 800 },
        { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 6 }
      ]);
      const { app } = buildApp();
      await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      const { main, options } = await prepare(app, { audioIndex: '1', playEverywhere: true });
      expect(main.inputOptions.mock.calls[0][0]).toEqual(
        expect.arrayContaining(['-hwaccel vaapi', '-hwaccel_device /dev/dri/renderD128', '-hwaccel_output_format vaapi'])
      );
      expect(options).toEqual(expect.arrayContaining(['-c:v h264_vaapi', '-vf scale_vaapi=format=nv12', '-b:v 5M']));
      expect(options.some((o) => o.startsWith('-force_key_frames'))).toBe(true);
      expect(options).not.toContain('-c:v copy');
      expect(options).not.toContain('-tag:v hvc1');
    });

    test('4K sources get a higher bitrate', async () => {
      setExists(['/valid/movie.mkv']);
      probeWith([{ index: 0, codec_type: 'video', codec_name: 'hevc', height: 2160 }]);
      const { app } = buildApp();
      await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      const { options } = await prepare(app, { audioIndex: 'none', playEverywhere: true });
      expect(options).toContain('-b:v 14M');
    });

    test('without a GPU, play everywhere falls back to the CPU encoder', async () => {
      mockGpu.value = null;
      setExists(['/valid/movie.mkv']);
      const { app } = buildApp();
      const { main, options } = await prepare(app, { audioIndex: '1', playEverywhere: true });
      expect(main.inputOptions.mock.calls[0][0]).toEqual([]);
      expect(options).toEqual(expect.arrayContaining(['-c:v libx264', '-preset veryfast']));
      mockGpu.value = { type: 'vaapi', device: '/dev/dri/renderD128', label: 'Intel GPU' };
    });

    test('by default the video is still copied, untouched', async () => {
      setExists(['/valid/movie.mkv']);
      const { main, options } = await prepare(buildApp().app, { audioIndex: '1' });
      expect(options).toContain('-c:v copy');
      expect(main.inputOptions.mock.calls[0][0]).toEqual([]);
    });

    test('subtitles are written to a temp file and published only when complete', async () => {
      setExists(['/valid/movie.mkv']);
      const { app } = buildApp(true);
      const instances = [];
      jest.requireMock('fluent-ffmpeg').mockImplementation(() => {
        const handlers = {};
        const inst = makeFfmpegInst((event, cb) => {
          handlers[event] = cb;
        });
        inst.handlers = handlers;
        instances.push(inst);
        return inst;
      });
      await request(app).post('/api/prepare').send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: '3' });
      await new Promise((r) => setTimeout(r, 30));

      const subJob = instances.find((i) => i.outputOptions.mock.calls[0][0].includes('-map 0:3'));
      expect(subJob.save.mock.calls[0][0]).toBe(path.join(MEDIA_DIR, 'subtitles.partial.vtt'));
      setExists(['/valid/movie.mkv', PLAYLIST_PATH]);
      expect((await request(app).get('/api/movie')).body.subtitles).toBe('pending');

      subJob.handlers.end();
      const fs = jest.requireMock('fs');
      expect(fs.renameSync).toHaveBeenCalledWith(path.join(MEDIA_DIR, 'subtitles.partial.vtt'), path.join(MEDIA_DIR, 'subtitles.vtt'));
      expect((await request(app).get('/api/movie')).body.subtitles).toBe('ready');
    });

    test('no subtitle track chosen → subtitles: none', async () => {
      setExists(['/valid/movie.mkv', PLAYLIST_PATH]);
      const { app } = buildApp(true);
      await prepare(app, { audioIndex: '1' });
      expect((await request(app).get('/api/movie')).body.subtitles).toBe('none');
    });

    test('timemarkToSeconds', () => {
      const { timemarkToSeconds } = require('../server/mediaManager');
      expect(timemarkToSeconds('01:02:03.50')).toBe(3723.5);
      expect(timemarkToSeconds('00:00:00.00')).toBe(0);
      expect(timemarkToSeconds('nope')).toBeNull();
    });
  });

  // ── parseRange ────────────────────────────────────────────────────────────

  describe('parseRange', () => {
    const { parseRange } = jest.requireActual('../server/mediaManager');
    test.each([
      ['bytes=0-99', { start: 0, end: 99 }],
      ['bytes=100-', { start: 100, end: 999 }],
      ['bytes=900-5000', { start: 900, end: 999 }],
      ['bytes=-200', { start: 800, end: 999 }],
      ['bytes=-5000', { start: 0, end: 999 }],
      ['bytes=0-1', { start: 0, end: 1 }],
      ['bytes=0-99, 200-299', { start: 0, end: 99 }],
      ['bytes=1000-', null],
      ['bytes=50-10', null],
      ['bytes=-0', null],
      ['bytes=-', undefined],
      ['items=0-5', undefined],
      ['garbage', undefined]
    ])('%s on a 1000-byte file → %p', (header, expected) => {
      expect(parseRange(header, 1000)).toEqual(expected);
    });
  });

  // ── GET /video ────────────────────────────────────────────────────────────

  describe('GET /video', () => {
    test('returns 404 when movie.mp4 is absent', async () => {
      // MOVIE_PATH not included in setExists → false
      const { app } = buildApp();
      const res = await request(app).get('/video');
      expect(res.status).toBe(404);
    });

    test('returns 200 with video/mp4 for full (no-range) request', async () => {
      setExists([MOVIE_PATH]);

      const fs = jest.requireMock('fs');
      fs.statSync.mockReturnValue({ size: 2048 });
      const fakeStream = new Readable({
        read() {
          this.push(Buffer.alloc(2048));
          this.push(null);
        },
      });
      fs.createReadStream.mockReturnValue(fakeStream);

      const { app } = buildApp();
      const res = await request(app).get('/video');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('video/mp4');
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    test('returns 206 Partial Content for a Range header request', async () => {
      setExists([MOVIE_PATH]);

      const fs = jest.requireMock('fs');
      fs.statSync.mockReturnValue({ size: 4096 });
      const { Readable } = require('stream');
      const fakeStream = new Readable({
        read() {
          this.push(Buffer.alloc(100));
          this.push(null);
        },
      });
      fs.createReadStream.mockReturnValue(fakeStream);

      const { app } = buildApp();
      const res = await request(app).get('/video').set('Range', 'bytes=0-99');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toMatch(/bytes 0-99\/4096/);
      expect(res.headers['content-length']).toBe('100');
    });

    test('returns 416 when range start exceeds file size', async () => {
      setExists([MOVIE_PATH]);

      const fs = jest.requireMock('fs');
      fs.statSync.mockReturnValue({ size: 100 });

      const { app } = buildApp();
      const res = await request(app).get('/video').set('Range', 'bytes=200-299');
      expect(res.status).toBe(416);
    });
  });
});
