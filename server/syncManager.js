const WebSocket = require('ws');

let wss = null;
let roomState = {
  currentVideoTime: 0,
  isPlaying: false,
  lastUpdated: Date.now()
};

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

function init(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'USER_JOIN') {
          ws.username = data.username || 'Anonymous';
          activeUsers++;
          
          const currentUsers = getUserList();
          wss.clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
              c.send(JSON.stringify({ type: 'SYSTEM_MESSAGE', text: `${ws.username} joined the party` }));
              c.send(JSON.stringify({ type: 'USER_COUNT', count: activeUsers }));
              c.send(JSON.stringify({ type: 'USER_LIST', users: currentUsers }));
            }
          });
        }
        else if (data.type === 'REQUEST_STATE') {
          let interpolatedTime = roomState.currentVideoTime;
          if (roomState.isPlaying) {
            interpolatedTime += (Date.now() - roomState.lastUpdated) / 1000;
          }
          ws.send(JSON.stringify({
            type: 'SYNC_ACTION',
            payload: { currentTime: interpolatedTime, action: roomState.isPlaying ? 'PLAY' : 'PAUSE' }
          }));
        } 
        else if (data.type === 'SYNC_ACTION') {
          const { action, currentTime } = data.payload || {};
          if (Number.isFinite(currentTime)) {
            roomState.currentVideoTime = currentTime;
          }
          // Only PLAY/PAUSE change whether the room is playing. A SEEK moves the
          // position but keeps the current state, so late joiners start correctly.
          if (action === 'PLAY') roomState.isPlaying = true;
          else if (action === 'PAUSE') roomState.isPlaying = false;
          roomState.lastUpdated = Date.now();
          
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'SYNC_ACTION', payload: data.payload }));
            }
          });
        }
        else if (data.type === 'CHAT_MESSAGE') {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(data));
            }
          });
        }
        else if (data.type === 'REACTION') {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(data));
            }
          });
        }
      } catch (e) {
        console.error('Socket message error', e);
      }
    });

    ws.on('close', () => {
      if (ws.username) {
        activeUsers--;
        const currentUsers = getUserList();
        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'SYSTEM_MESSAGE', text: `${ws.username} left the party` }));
            c.send(JSON.stringify({ type: 'USER_COUNT', count: activeUsers }));
            c.send(JSON.stringify({ type: 'USER_LIST', users: currentUsers }));
          }
        });
      }
    });
  });
}

function resetRoomState() {
  roomState.currentVideoTime = 0;
  roomState.isPlaying = false;
  roomState.lastUpdated = Date.now();
}

function getWss() {
  return wss;
}

module.exports = { init, getWss, resetRoomState };
