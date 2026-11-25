const express = require('express');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const mediaManager = require('./server/mediaManager');
const syncManager = require('./server/syncManager');
const fileBrowser = require('./server/fileBrowser');
const { requireHost } = require('./server/host');
const { createRouteGuard } = require('./server/routeGuard');

const app = express();
const server = http.createServer(app);

const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');
const appState = {
  shareUrl: null,
  isPartyActive: fs.existsSync(mediaManager.MOVIE_PATH)
};
mediaManager.setAppState(appState);

app.use(express.json());

// Route guard: host → setup until a movie is ready; guests → the watch room
app.use(createRouteGuard(appState));

app.use(express.static(DIST_DIR));
app.use('/media', express.static(mediaManager.MEDIA_DIR));

// Attach media routes
app.use('/', mediaManager.router);
app.use('/', fileBrowser.router);

// Reset party endpoint
app.post('/api/reset-party', requireHost, (req, res) => {
  appState.isPartyActive = false;
  syncManager.resetRoomState();
  const wss = syncManager.getWss();
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'MEDIA_CHANGING' }));
      }
    });
  }
  res.json({ success: true, message: 'Party reset initiated' });
});

// Attach websocket sync
syncManager.init(server);

// Share URL endpoint
app.get('/api/share-url', (req, res) => {
  if (appState.shareUrl) {
    res.json({ url: `${appState.shareUrl}/watch.html` });
  } else {
    res.json({ url: `${req.protocol}://${req.get('host')}/watch.html` });
  }
});

let cloudflaredProcess = null;

function startCloudflareTunnel() {
  cloudflaredProcess = spawn('npx', [
    'cloudflared', 'tunnel',
    '--protocol', 'http2',
    '--edge-ip-version', '4',
    '--no-prechecks',
    '--url', `http://localhost:${PORT}`
  ]);

  cloudflaredProcess.stderr.on('data', (data) => {
    const output = data.toString();
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== 'https://api.trycloudflare.com') {
      if (!appState.shareUrl) {
        appState.shareUrl = match[0];
        console.log(`\n🚀 CLOUDFLARE SHARE LINK: ${appState.shareUrl}\n`);
      }
    }
  });

  cloudflaredProcess.on('close', (code) => {
    console.log(`Cloudflared exited with code ${code}, retrying...`);
    appState.shareUrl = null;
    setTimeout(startCloudflareTunnel, 4000);
  });
}

// Graceful shutdown
function shutdown() {
  console.log('Shutting down gracefully...');
  if (cloudflaredProcess) {
    cloudflaredProcess.kill('SIGTERM');
  }
  process.exit();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!fs.existsSync(path.join(DIST_DIR, 'setup.html'))) {
  console.warn('\n⚠️  The frontend has not been built yet. Run `npm start` (or `npm run build`) instead of `node server.js`.\n');
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startCloudflareTunnel();
});
