const WebSocket = require('ws');
const { isHostRequest } = require('./host');
const permissions = require('./permissions');

let wss = null;
let roomState = {
  currentVideoTime: 0,
  isPlaying: false,
  lastUpdated: Date.now(),
  lastBy: null
};

const MAX_CHAT_LENGTH = 500;

function sendToOthers(sender, message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client !== sender && client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function sendToAll(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

let activeUsers = 0;

function getUserList() {
  const users = [];
  if (wss) {
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN && c.username) {
        users.push(c.username);
      }
    });
  }
  return users;
}

function getHostList() {
  const hosts = [];
  if (wss) {
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN && c.username && c.isHost) hosts.push(c.username);
    });
  }
  return hosts;
}

function currentState() {
  let interpolatedTime = roomState.currentVideoTime;
  if (roomState.isPlaying) {
    interpolatedTime += (Date.now() - roomState.lastUpdated) / 1000;
  }
  // `initial` tells the client this is a catch-up, not someone acting right now.
  return {
    currentTime: interpolatedTime,
    action: roomState.isPlaying ? 'PLAY' : 'PAUSE',
    initial: true,
    by: roomState.lastBy
  };
}

function deny(ws, capability) {
  ws.send(JSON.stringify({ type: 'PERMISSION_DENIED', capability }));
}

function broadcastPermissions(by = null) {
  if (!wss) return;
  sendToAll({ type: 'PERMISSIONS', permissions: permissions.getPermissions(), by });
}

function init(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    ws.isHost = req ? isHostRequest(req) : false;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'HELLO') {
          ws.send(JSON.stringify({ type: 'WELCOME', isHost: ws.isHost, permissions: permissions.getPermissions() }));
        }
        else if (data.type === 'SET_PERMISSIONS') {
          if (!ws.isHost) return deny(ws, 'settings');
          permissions.setPermissions(data.permissions || {});
          broadcastPermissions(ws.username || null);
        }
        else if (data.type === 'USER_JOIN') {
          ws.username = data.username || 'Anonymous';
          activeUsers++;
          
          const currentUsers = getUserList();
          const hosts = getHostList();
          wss.clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
              c.send(JSON.stringify({ type: 'SYSTEM_MESSAGE', text: `${ws.username} joined the party` }));
              c.send(JSON.stringify({ type: 'USER_COUNT', count: activeUsers }));
              c.send(JSON.stringify({ type: 'USER_LIST', users: currentUsers, hosts }));
            }
          });
        }
        else if (data.type === 'REQUEST_STATE') {
          ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: currentState() }));
        } 
        else if (data.type === 'SYNC_ACTION') {
          const { action, currentTime } = data.payload || {};
          const capability = permissions.capabilityForAction(action);
          if (capability && !permissions.can(ws.isHost, capability)) {
            // Not allowed: tell them, and snap their player back to the room.
            deny(ws, capability);
            ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: currentState() }));
            return;
          }
          if (Number.isFinite(currentTime)) {
            roomState.currentVideoTime = currentTime;
          }
          // Only PLAY/PAUSE change whether the room is playing. A SEEK moves the
          // position but keeps the current state, so late joiners start correctly.
          if (action === 'PLAY') roomState.isPlaying = true;
          else if (action === 'PAUSE') roomState.isPlaying = false;
          roomState.lastUpdated = Date.now();
          roomState.lastBy = ws.username || null;

          // Tell everyone else who did it, so they can see "Paused by Priya".
          sendToOthers(ws, { type: 'SYNC_ACTION', payload: { ...data.payload, by: ws.username || null } });
        }
        else if (data.type === 'TYPING') {
          if (ws.username && permissions.can(ws.isHost, 'chat')) {
            sendToOthers(ws, { type: 'TYPING', username: ws.username, typing: Boolean(data.typing) });
          }
        }
        else if (data.type === 'CHAT_MESSAGE') {
          if (!permissions.can(ws.isHost, 'chat')) return deny(ws, 'chat');
          const text = String(data.text || '').trim().slice(0, MAX_CHAT_LENGTH);
          if (!text) return;
          sendToAll({
            type: 'CHAT_MESSAGE',
            // Use the name this socket joined with, so nobody can post as someone else.
            username: ws.username || String(data.username || 'Anonymous'),
            text,
            timestamp: Number.isFinite(data.timestamp) ? data.timestamp : Date.now(),
            movieTime: Number.isFinite(data.movieTime) ? data.movieTime : null
          });
        }
        else if (data.type === 'REACTION') {
          if (!permissions.can(ws.isHost, 'reactions')) return deny(ws, 'reactions');
          sendToAll({ type: 'REACTION', emoji: String(data.emoji || '').slice(0, 8) });
        }
      } catch (e) {
        console.error('Socket message error', e);
      }
    });

    ws.on('close', () => {
      if (ws.username) {
        activeUsers--;
        const currentUsers = getUserList();
        const hosts = getHostList();
        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'SYSTEM_MESSAGE', text: `${ws.username} left the party` }));
            c.send(JSON.stringify({ type: 'USER_COUNT', count: activeUsers }));
            c.send(JSON.stringify({ type: 'USER_LIST', users: currentUsers, hosts }));
          }
        });
        // Clear any "is typing…" left behind by someone who just left.
        sendToOthers(ws, { type: 'TYPING', username: ws.username, typing: false });
      }
    });
  });
}

function resetRoomState() {
  roomState.currentVideoTime = 0;
  roomState.isPlaying = false;
  roomState.lastUpdated = Date.now();
  roomState.lastBy = null;
}

function getWss() {
  return wss;
}

module.exports = { init, getWss, resetRoomState, broadcastPermissions };
