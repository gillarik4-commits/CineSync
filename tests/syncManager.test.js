'use strict';
/**
 * Unit tests for syncManager.js
 *
 * Tests cover:
 *  - resetRoomState() zeroing time + pausing
 *  - REQUEST_STATE interpolation when playing vs paused
 *  - SYNC_ACTION fan-out (doesn't echo to sender)
 *  - USER_JOIN / ws.close user-count bookkeeping
 *  - CHAT_MESSAGE and REACTION broadcast
 */

const WebSocket = require('ws');
const http = require('http');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeServer(syncManager) {
  const server = http.createServer();
  syncManager.init(server);
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

function wsConnect(server, { guest = false } = {}) {
  const { port } = server.address();
  // Guests come through the Cloudflare tunnel, which adds this header.
  const ws = new WebSocket(`ws://localhost:${port}`, guest ? { headers: { 'cf-connecting-ip': '203.0.113.7' } } : {});
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data)));
    ws.once('error', reject);
  });
}

function collectMessages(ws, count, timeoutMs = 500) {
  return new Promise((resolve) => {
    const messages = [];
    const done = () => {
      ws.removeListener('message', onMsg);
      resolve(messages);
    };
    const timer = setTimeout(done, timeoutMs);
    const onMsg = (data) => {
      messages.push(JSON.parse(data));
      if (messages.length >= count) {
        clearTimeout(timer);
        done();
      }
    };
    ws.on('message', onMsg);
  });
}

function closeAll(...sockets) {
  return Promise.all(
    sockets.map(
      (s) =>
        new Promise((r) => {
          if (s.readyState === WebSocket.OPEN) {
            s.once('close', r);
            s.close();
          } else {
            r();
          }
        })
    )
  );
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('syncManager', () => {
  let server;
  let syncManager;

  beforeEach(async () => {
    // Fresh module instance per test to avoid state leakage
    jest.resetModules();
    syncManager = require('../server/syncManager');
    server = await makeServer(syncManager);
  });

  afterEach(async () => {
    // Terminate any lingering WS clients so server.close() doesn't hang
    const wss = syncManager.getWss();
    if (wss) {
      wss.clients.forEach((c) => c.terminate());
    }
    await new Promise((r) => server.close(r));
  });

  // ── resetRoomState ─────────────────────────────────────────────────────────

  describe('resetRoomState()', () => {
    test('resets currentVideoTime to 0 and isPlaying to false', async () => {
      // Simulate some state via a SYNC_ACTION
      const ws1 = await wsConnect(server);

      ws1.send(
        JSON.stringify({
          type: 'SYNC_ACTION',
          payload: { currentTime: 42.5, action: 'PLAY' },
        })
      );
      // Allow the message to process
      await new Promise((r) => setTimeout(r, 50));

      // Now reset
      syncManager.resetRoomState();

      // After reset, REQUEST_STATE should report time=0 and PAUSE
      const ws2 = await wsConnect(server);
      // Drain the join messages first
      await new Promise((r) => setTimeout(r, 50));

      const resultP = nextMessage(ws2);
      ws2.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const result = await resultP;

      expect(result.type).toBe('SYNC_ACTION');
      expect(result.payload.currentTime).toBeCloseTo(0, 1);
      expect(result.payload.action).toBe('PAUSE');

      await closeAll(ws1, ws2);
    });

    test('subsequent REQUEST_STATE after reset does not drift', async () => {
      // Set up a playing state
      const ws1 = await wsConnect(server);
      ws1.send(
        JSON.stringify({
          type: 'SYNC_ACTION',
          payload: { currentTime: 120, action: 'PLAY' },
        })
      );
      await new Promise((r) => setTimeout(r, 50));

      syncManager.resetRoomState();

      const ws2 = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 150)); // wait 150ms; isPlaying=false so no drift

      const resultP = nextMessage(ws2);
      ws2.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const result = await resultP;

      // Should still be ~0 because isPlaying is false after reset
      expect(result.payload.currentTime).toBeCloseTo(0, 0);

      await closeAll(ws1, ws2);
    });
  });

  // ── REQUEST_STATE ──────────────────────────────────────────────────────────

  describe('REQUEST_STATE', () => {
    test('returns PAUSE when room is paused', async () => {
      const ws = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      const p = nextMessage(ws);
      ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const msg = await p;

      expect(msg.type).toBe('SYNC_ACTION');
      expect(msg.payload.action).toBe('PAUSE');
      expect(msg.payload.currentTime).toBeGreaterThanOrEqual(0);

      await closeAll(ws);
    });

    test('interpolates time when room is playing', async () => {
      const ws = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      // Kick off a play sync
      ws.send(
        JSON.stringify({
          type: 'SYNC_ACTION',
          payload: { currentTime: 10, action: 'PLAY' },
        })
      );
      // Wait 200ms, then request state
      await new Promise((r) => setTimeout(r, 200));

      const p = nextMessage(ws);
      ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const msg = await p;

      expect(msg.payload.action).toBe('PLAY');
      // Time should have advanced at least 0.15s from 10s
      expect(msg.payload.currentTime).toBeGreaterThan(10.1);

      await closeAll(ws);
    });

    test('a SEEK while playing keeps the room playing (late joiners start playing)', async () => {
      const ws = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { currentTime: 10, action: 'PLAY' } }));
      ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { currentTime: 300, action: 'SEEK' } }));
      await new Promise((r) => setTimeout(r, 150));

      const late = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));
      const p = nextMessage(late);
      late.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const msg = await p;

      expect(msg.payload.action).toBe('PLAY');
      expect(msg.payload.currentTime).toBeGreaterThan(300);
      expect(msg.payload.currentTime).toBeLessThan(301);

      await closeAll(ws, late);
    });

    test('a SEEK while paused keeps the room paused at the new position', async () => {
      const ws = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { currentTime: 10, action: 'PAUSE' } }));
      ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { currentTime: 75, action: 'SEEK' } }));
      await new Promise((r) => setTimeout(r, 150));

      const p = nextMessage(ws);
      ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const msg = await p;

      expect(msg.payload.action).toBe('PAUSE');
      expect(msg.payload.currentTime).toBe(75);

      await closeAll(ws);
    });

    test('tells other viewers who acted, and late joiners who acted last', async () => {
      const ana = await wsConnect(server);
      const ben = await wsConnect(server);
      ana.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ana' }));
      ben.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ben' }));
      await new Promise((r) => setTimeout(r, 80));

      const received = collectMessages(ben, 1, 500);
      ana.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { currentTime: 12, action: 'PAUSE' } }));
      const [msg] = await received;
      expect(msg).toEqual({ type: 'SYNC_ACTION', payload: { currentTime: 12, action: 'PAUSE', by: 'Ana' } });

      const late = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));
      const p = nextMessage(late);
      late.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const state = await p;
      expect(state.payload).toMatchObject({ action: 'PAUSE', currentTime: 12, initial: true, by: 'Ana' });

      await closeAll(ana, ben, late);
    });

    test('ignores a sync message without a valid time', async () => {
      const ws = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { currentTime: 42, action: 'PAUSE' } }));
      ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { currentTime: 'abc', action: 'SEEK' } }));
      await new Promise((r) => setTimeout(r, 80));

      const p = nextMessage(ws);
      ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const msg = await p;

      expect(msg.payload.currentTime).toBe(42);

      await closeAll(ws);
    });
  });

  // ── SYNC_ACTION fan-out ────────────────────────────────────────────────────

  describe('SYNC_ACTION', () => {
    test('broadcasts to other clients but not sender', async () => {
      const ws1 = await wsConnect(server);
      const ws2 = await wsConnect(server);
      const ws3 = await wsConnect(server);

      // Drain join noise
      await new Promise((r) => setTimeout(r, 80));

      const p2 = nextMessage(ws2);
      const p3 = nextMessage(ws3);

      ws1.send(
        JSON.stringify({
          type: 'SYNC_ACTION',
          payload: { currentTime: 55, action: 'SEEK' },
        })
      );

      const [m2, m3] = await Promise.all([p2, p3]);
      expect(m2.type).toBe('SYNC_ACTION');
      expect(m2.payload.currentTime).toBe(55);
      expect(m3.type).toBe('SYNC_ACTION');
      expect(m3.payload.currentTime).toBe(55);

      // ws1 should NOT receive the message back
      let senderReceivedEcho = false;
      ws1.on('message', () => {
        senderReceivedEcho = true;
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(senderReceivedEcho).toBe(false);

      await closeAll(ws1, ws2, ws3);
    });

    test('updates internal roomState on SYNC_ACTION', async () => {
      const ws = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      ws.send(
        JSON.stringify({
          type: 'SYNC_ACTION',
          payload: { currentTime: 77, action: 'PAUSE' },
        })
      );
      await new Promise((r) => setTimeout(r, 50));

      // Verify via REQUEST_STATE
      const p = nextMessage(ws);
      ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
      const msg = await p;
      expect(msg.payload.action).toBe('PAUSE');
      expect(msg.payload.currentTime).toBeCloseTo(77, 1);

      await closeAll(ws);
    });
  });

  // ── USER_JOIN / USER_COUNT ─────────────────────────────────────────────────

  describe('USER_JOIN', () => {
    test('broadcasts USER_COUNT when a user joins', async () => {
      const ws1 = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      const msgP = collectMessages(ws1, 2, 300); // SYSTEM_MESSAGE + USER_COUNT
      ws1.send(JSON.stringify({ type: 'USER_JOIN', username: 'Alice' }));
      const msgs = await msgP;

      const countMsg = msgs.find((m) => m.type === 'USER_COUNT');
      expect(countMsg).toBeTruthy();
      expect(countMsg.count).toBeGreaterThanOrEqual(1);

      await closeAll(ws1);
    });

    test('broadcasts SYSTEM_MESSAGE join announcement', async () => {
      const ws1 = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 30));

      const msgP = collectMessages(ws1, 2, 300);
      ws1.send(JSON.stringify({ type: 'USER_JOIN', username: 'Bob' }));
      const msgs = await msgP;

      const sysMsg = msgs.find((m) => m.type === 'SYSTEM_MESSAGE');
      expect(sysMsg).toBeTruthy();
      expect(sysMsg.text).toContain('Bob');

      await closeAll(ws1);
    });

    test('decrements count and announces when user disconnects', async () => {
      const ws1 = await wsConnect(server);
      const ws2 = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 50));

      // ws2 joins with a name so disconnect gets announced
      ws2.send(JSON.stringify({ type: 'USER_JOIN', username: 'Carol' }));
      await new Promise((r) => setTimeout(r, 80));

      const msgP = collectMessages(ws1, 2, 1000);
      ws2.terminate(); // trigger server-side 'close' event immediately
      const msgs = await msgP;

      const countMsg = msgs.find((m) => m.type === 'USER_COUNT');
      expect(countMsg).toBeTruthy();

      await closeAll(ws1);
    });
  });

  // ── CHAT_MESSAGE ───────────────────────────────────────────────────────────

  describe('CHAT_MESSAGE', () => {
    test('broadcasts chat to all connected clients', async () => {
      const ws1 = await wsConnect(server);
      const ws2 = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 50));

      const p1 = nextMessage(ws1);
      const p2 = nextMessage(ws2);

      ws1.send(
        JSON.stringify({
          type: 'CHAT_MESSAGE',
          username: 'Dave',
          text: 'hello',
          timestamp: Date.now(),
        })
      );

      const [m1, m2] = await Promise.all([p1, p2]);
      expect(m1.type).toBe('CHAT_MESSAGE');
      expect(m1.text).toBe('hello');
      expect(m2.type).toBe('CHAT_MESSAGE');

      await closeAll(ws1, ws2);
    });
  });

  // ── REACTION ───────────────────────────────────────────────────────────────

  describe('REACTION', () => {
    test('broadcasts reaction emoji to all clients', async () => {
      const ws1 = await wsConnect(server);
      const ws2 = await wsConnect(server);
      await new Promise((r) => setTimeout(r, 50));

      const p2 = nextMessage(ws2);
      ws1.send(JSON.stringify({ type: 'REACTION', emoji: '🎉' }));
      const msg = await p2;

      expect(msg.type).toBe('REACTION');
      expect(msg.emoji).toBe('🎉');

      await closeAll(ws1, ws2);
    });
  });

  // ── getWss ─────────────────────────────────────────────────────────────────

  describe('getWss()', () => {
    test('returns the wss instance after init', () => {
      const wss = syncManager.getWss();
      expect(wss).not.toBeNull();
      expect(typeof wss.clients).toBe('object');
    });
  });

  // ── TYPING & chat hardening ────────────────────────────────────────────────

  describe('TYPING', () => {
    test('relays typing to others with the joined name, not to the sender', async () => {
      const ana = await wsConnect(server);
      const ben = await wsConnect(server);
      ana.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ana' }));
      ben.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ben' }));
      await new Promise((r) => setTimeout(r, 80));

      const benGets = collectMessages(ben, 1, 400);
      const anaGets = collectMessages(ana, 1, 200);
      ana.send(JSON.stringify({ type: 'TYPING', typing: true, username: 'Spoofed' }));
      expect(await benGets).toEqual([{ type: 'TYPING', username: 'Ana', typing: true }]);
      expect(await anaGets).toEqual([]);

      await closeAll(ana, ben);
    });

    test('ignores typing from someone who has not joined', async () => {
      const anon = await wsConnect(server);
      const ben = await wsConnect(server);
      ben.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ben' }));
      await new Promise((r) => setTimeout(r, 80));

      const benGets = collectMessages(ben, 1, 250);
      anon.send(JSON.stringify({ type: 'TYPING', typing: true }));
      expect(await benGets).toEqual([]);

      await closeAll(anon, ben);
    });

    test('clears typing for someone who leaves', async () => {
      const ana = await wsConnect(server);
      const ben = await wsConnect(server);
      ana.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ana' }));
      ben.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ben' }));
      await new Promise((r) => setTimeout(r, 80));

      const benGets = collectMessages(ben, 4, 800);
      ana.terminate();
      const msgs = await benGets;
      expect(msgs).toContainEqual({ type: 'TYPING', username: 'Ana', typing: false });

      await closeAll(ben);
    });
  });

  describe('CHAT_MESSAGE hardening', () => {
    test('uses the joined name, keeps movieTime, and trims text', async () => {
      const ana = await wsConnect(server);
      ana.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ana' }));
      await new Promise((r) => setTimeout(r, 60));

      const p = collectMessages(ana, 1, 500);
      ana.send(
        JSON.stringify({ type: 'CHAT_MESSAGE', username: 'Mallory', text: '  hi  ', timestamp: 5, movieTime: 2832.4 })
      );
      expect(await p).toEqual([
        { type: 'CHAT_MESSAGE', username: 'Ana', text: 'hi', timestamp: 5, movieTime: 2832.4 }
      ]);

      await closeAll(ana);
    });

    test('drops empty messages', async () => {
      const ana = await wsConnect(server);
      ana.send(JSON.stringify({ type: 'USER_JOIN', username: 'Ana' }));
      await new Promise((r) => setTimeout(r, 60));

      const p = collectMessages(ana, 1, 250);
      ana.send(JSON.stringify({ type: 'CHAT_MESSAGE', text: '   ' }));
      expect(await p).toEqual([]);

      await closeAll(ana);
    });
  });

  // ── Host & guest permissions ───────────────────────────────────────────────

  describe('permissions', () => {
    async function room() {
      const host = await wsConnect(server);
      const guest = await wsConnect(server, { guest: true });
      host.send(JSON.stringify({ type: 'USER_JOIN', username: 'Host' }));
      guest.send(JSON.stringify({ type: 'USER_JOIN', username: 'Guest' }));
      await new Promise((r) => setTimeout(r, 80));
      return { host, guest };
    }

    async function setPerms(host, perms) {
      host.send(JSON.stringify({ type: 'SET_PERMISSIONS', permissions: perms }));
      await new Promise((r) => setTimeout(r, 60));
    }

    test('WELCOME tells each socket whether it is the host', async () => {
      const { host, guest } = await room();
      const hp = nextMessage(host);
      const gp = nextMessage(guest);
      host.send(JSON.stringify({ type: 'HELLO' }));
      guest.send(JSON.stringify({ type: 'HELLO' }));
      expect(await hp).toMatchObject({ type: 'WELCOME', isHost: true, permissions: { playback: true } });
      expect(await gp).toMatchObject({ type: 'WELCOME', isHost: false });
      await closeAll(host, guest);
    });

    test('USER_LIST says who the host is', async () => {
      const host = await wsConnect(server);
      const guest = await wsConnect(server, { guest: true });
      host.send(JSON.stringify({ type: 'USER_JOIN', username: 'Host' }));
      await new Promise((r) => setTimeout(r, 50));
      const msgs = collectMessages(host, 3, 500);
      guest.send(JSON.stringify({ type: 'USER_JOIN', username: 'Guest' }));
      const list = (await msgs).find((m) => m.type === 'USER_LIST');
      expect(list.users.sort()).toEqual(['Guest', 'Host']);
      expect(list.hosts).toEqual(['Host']);
      await closeAll(host, guest);
    });

    test('only the host can change permissions; everyone hears about it', async () => {
      const { host, guest } = await room();

      const denied = collectMessages(guest, 1, 300);
      guest.send(JSON.stringify({ type: 'SET_PERMISSIONS', permissions: { chat: false } }));
      expect(await denied).toEqual([{ type: 'PERMISSION_DENIED', capability: 'settings' }]);

      const heard = collectMessages(guest, 1, 300);
      host.send(JSON.stringify({ type: 'SET_PERMISSIONS', permissions: { seek: false } }));
      expect(await heard).toEqual([
        { type: 'PERMISSIONS', by: 'Host', permissions: { playback: true, seek: false, chat: true, reactions: true } }
      ]);
      await closeAll(host, guest);
    });

    test('a guest without playback permission is denied and snapped back; the room is untouched', async () => {
      const { host, guest } = await room();
      host.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { action: 'PLAY', currentTime: 100 } }));
      await setPerms(host, { playback: false });

      const hostHears = collectMessages(host, 1, 300);
      const guestGets = collectMessages(guest, 2, 400);
      guest.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { action: 'PAUSE', currentTime: 100 } }));

      const [deny, snap] = await guestGets;
      expect(deny).toEqual({ type: 'PERMISSION_DENIED', capability: 'playback' });
      expect(snap.type).toBe('SYNC_ACTION');
      expect(snap.payload).toMatchObject({ action: 'PLAY', initial: true });
      expect(await hostHears).toEqual([]);
      await closeAll(host, guest);
    });

    test('seek permission is separate from playback', async () => {
      const { host, guest } = await room();
      await setPerms(host, { seek: false });

      const hostHears = collectMessages(host, 1, 300);
      guest.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { action: 'PAUSE', currentTime: 5 } }));
      expect((await hostHears)[0]).toMatchObject({ type: 'SYNC_ACTION', payload: { action: 'PAUSE', by: 'Guest' } });

      const guestGets = collectMessages(guest, 1, 300);
      guest.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { action: 'SEEK', currentTime: 500 } }));
      expect((await guestGets)[0]).toEqual({ type: 'PERMISSION_DENIED', capability: 'seek' });
      await closeAll(host, guest);
    });

    test('the host is never restricted', async () => {
      const { host, guest } = await room();
      await setPerms(host, { playback: false, seek: false, chat: false, reactions: false });

      const guestHears = collectMessages(guest, 3, 500);
      host.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { action: 'SEEK', currentTime: 42 } }));
      host.send(JSON.stringify({ type: 'CHAT_MESSAGE', text: 'host here' }));
      host.send(JSON.stringify({ type: 'REACTION', emoji: '🔥' }));
      const types = (await guestHears).map((m) => m.type);
      expect(types).toEqual(['SYNC_ACTION', 'CHAT_MESSAGE', 'REACTION']);
      await closeAll(host, guest);
    });

    test('chat and reactions can be turned off for guests', async () => {
      const { host, guest } = await room();
      await setPerms(host, { chat: false, reactions: false });

      const hostHears = collectMessages(host, 1, 300);
      const guestGets = collectMessages(guest, 3, 400);
      guest.send(JSON.stringify({ type: 'CHAT_MESSAGE', text: 'hi' }));
      guest.send(JSON.stringify({ type: 'REACTION', emoji: '😂' }));
      guest.send(JSON.stringify({ type: 'TYPING', typing: true }));

      expect(await hostHears).toEqual([]);
      expect(await guestGets).toEqual([
        { type: 'PERMISSION_DENIED', capability: 'chat' },
        { type: 'PERMISSION_DENIED', capability: 'reactions' }
      ]);
      await closeAll(host, guest);
    });
  });
});
