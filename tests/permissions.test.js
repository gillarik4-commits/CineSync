const express = require('express');
const request = require('supertest');
const { isHostRequest, requireHost } = require('../server/host');
const { createRouteGuard } = require('../server/routeGuard');

const GUEST = { 'cf-connecting-ip': '203.0.113.7' };

describe('isHostRequest', () => {
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
  test('loopback without proxy headers is the host', () => {
    expect(isHostRequest(req('127.0.0.1'))).toBe(true);
    expect(isHostRequest(req('::1'))).toBe(true);
  });
  test('tunnel traffic and other machines are guests', () => {
    expect(isHostRequest(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' }))).toBe(false);
    expect(isHostRequest(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' }))).toBe(false);
    expect(isHostRequest(req('192.168.1.40'))).toBe(false);
    expect(isHostRequest({ headers: {} })).toBe(false);
  });
});

describe('requireHost', () => {
  const app = express();
  app.post('/secret', requireHost, (_req, res) => res.json({ ok: true }));
  test('lets the host through', async () => {
    expect((await request(app).post('/secret')).status).toBe(200);
  });
  test('blocks guests with 403', async () => {
    const res = await request(app).post('/secret').set(GUEST);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/host/);
  });
});

describe('route guard', () => {
  const build = (isPartyActive) => {
    const app = express();
    app.use(createRouteGuard({ isPartyActive }));
    app.get('/setup.html', (_req, res) => res.send('setup'));
    app.get('/watch.html', (_req, res) => res.send('watch'));
    return app;
  };

  test.each([
    // [party active, path, guest?, expected redirect or body]
    [false, '/', false, '/setup.html'],
    [true, '/', false, '/watch.html'],
    [false, '/setup.html', false, 'setup'],
    [true, '/setup.html', false, '/watch.html'],
    [false, '/', true, '/watch.html'],
    [false, '/setup.html', true, '/watch.html'],
    [true, '/index.html', true, '/watch.html'],
    [false, '/watch.html', true, 'watch']
  ])('party=%p %s guest=%p → %s', async (active, path, guest, expected) => {
    let r = request(build(active)).get(path);
    if (guest) r = r.set(GUEST);
    const res = await r;
    if (expected.startsWith('/')) {
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(expected);
    } else {
      expect(res.text).toBe(expected);
    }
  });
});

describe('permissions module', () => {
  let permissions;
  beforeEach(() => {
    jest.resetModules();
    permissions = require('../server/permissions');
  });

  test('defaults let guests do everything', () => {
    expect(permissions.getPermissions()).toEqual({ playback: true, seek: true, chat: true, reactions: true });
  });

  test('normalize keeps known boolean keys only', () => {
    expect(permissions.normalizePermissions({ seek: false, chat: 'no', admin: true })).toEqual({
      playback: true,
      seek: false,
      chat: true,
      reactions: true
    });
  });

  test('the host can always act; guests follow the settings', () => {
    permissions.setPermissions({ playback: false });
    expect(permissions.can(true, 'playback')).toBe(true);
    expect(permissions.can(false, 'playback')).toBe(false);
    expect(permissions.can(false, 'seek')).toBe(true);
  });

  test('capabilityForAction', () => {
    expect(permissions.capabilityForAction('PLAY')).toBe('playback');
    expect(permissions.capabilityForAction('PAUSE')).toBe('playback');
    expect(permissions.capabilityForAction('SEEK')).toBe('seek');
    expect(permissions.capabilityForAction('NOPE')).toBeNull();
  });
});
