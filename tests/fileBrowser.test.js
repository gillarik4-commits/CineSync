/**
 * tests/fileBrowser.test.js
 * GET /api/browse against a real temporary directory tree.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const fileBrowser = require('../server/fileBrowser');

let root;
let app;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cinesync-fb-'));
  fs.mkdirSync(path.join(root, 'Season 10'));
  fs.mkdirSync(path.join(root, 'Season 2'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'Movie.MKV'), Buffer.alloc(2048));
  fs.writeFileSync(path.join(root, 'another.mp4'), '');
  fs.writeFileSync(path.join(root, 'notes.txt'), '');
  fs.writeFileSync(path.join(root, 'subs.srt'), '');
  fs.writeFileSync(path.join(root, '.secret.mp4'), '');
  fs.symlinkSync(path.join(root, 'Season 2'), path.join(root, 'link-to-season'));
  fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'broken-link'));

  app = express();
  app.use('/', fileBrowser.router);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('GET /api/browse', () => {
  test('lists folders first (natural sort), then video files; hides dotfiles and other types', async () => {
    const res = await request(app).get('/api/browse').query({ dir: root });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(root);
    expect(res.body.parent).toBe(path.dirname(root));
    expect(res.body.entries.map(e => [e.type, e.name])).toEqual([
      ['dir', 'link-to-season'],
      ['dir', 'Season 2'],
      ['dir', 'Season 10'],
      ['file', 'another.mp4'],
      ['file', 'Movie.MKV']
    ]);
  });

  test('includes absolute paths and file sizes', async () => {
    const res = await request(app).get('/api/browse').query({ dir: root });
    const movie = res.body.entries.find(e => e.name === 'Movie.MKV');
    expect(movie.path).toBe(path.join(root, 'Movie.MKV'));
    expect(movie.size).toBe(2048);
  });

  test('kind=subtitle lists subtitle files instead of videos', async () => {
    const res = await request(app).get('/api/browse').query({ dir: root, kind: 'subtitle' });
    expect(res.status).toBe(200);
    expect(res.body.entries.filter(e => e.type === 'file').map(e => e.name)).toEqual(['subs.srt']);
  });

  test('defaults to the home directory and returns places', async () => {
    const res = await request(app).get('/api/browse');
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(path.resolve(os.homedir()));
    expect(res.body.places.find(p => p.label === 'Home').path).toBe(os.homedir());
  });

  test('parent is null at the filesystem root', async () => {
    const res = await request(app).get('/api/browse').query({ dir: path.parse(root).root });
    expect(res.status).toBe(200);
    expect(res.body.parent).toBeNull();
  });

  test('404 for a missing folder', async () => {
    const res = await request(app).get('/api/browse').query({ dir: path.join(root, 'nope') });
    expect(res.status).toBe(404);
  });

  test('400 when the path is a file', async () => {
    const res = await request(app).get('/api/browse').query({ dir: path.join(root, 'Movie.MKV') });
    expect(res.status).toBe(400);
  });

  test.each([
    ['cf-connecting-ip', '203.0.113.5'],
    ['cf-ray', 'abc123-LHR'],
    ['x-forwarded-for', '203.0.113.5']
  ])('403 for requests arriving through a proxy/tunnel (%s)', async (header, value) => {
    const res = await request(app).get('/api/browse').query({ dir: root }).set(header, value);
    expect(res.status).toBe(403);
    expect(res.body.entries).toBeUndefined();
  });
});

describe('isHostRequest', () => {
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

  test('accepts loopback addresses', () => {
    expect(fileBrowser.isHostRequest(req('127.0.0.1'))).toBe(true);
    expect(fileBrowser.isHostRequest(req('::1'))).toBe(true);
    expect(fileBrowser.isHostRequest(req('::ffff:127.0.0.1'))).toBe(true);
  });

  test('rejects LAN / remote addresses', () => {
    expect(fileBrowser.isHostRequest(req('192.168.1.20'))).toBe(false);
    expect(fileBrowser.isHostRequest(req('203.0.113.5'))).toBe(false);
  });
});
