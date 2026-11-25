const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const router = express.Router();

const EXTENSIONS = {
  video: new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.wmv', '.flv', '.ts', '.m2ts']),
  subtitle: new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub'])
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Directory listing exposes the host's filesystem, so only allow it for
 * requests made directly on the host machine. Traffic arriving through the
 * Cloudflare tunnel also comes from localhost (cloudflared runs locally), so
 * we additionally reject anything carrying proxy headers.
 */
function isHostRequest(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  if (req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['x-forwarded-for']) return false;
  return true;
}

function getPlaces() {
  const home = os.homedir();
  const candidates = [
    { label: 'Home', path: home },
    { label: 'Videos', path: path.join(home, 'Videos') },
    { label: 'Movies', path: path.join(home, 'Movies') },
    { label: 'Downloads', path: path.join(home, 'Downloads') },
    { label: 'Desktop', path: path.join(home, 'Desktop') }
  ];

  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      candidates.push({ label: `${letter}:`, path: `${letter}:\\` });
    }
  } else {
    candidates.push({ label: 'Root', path: '/' });
    for (const mountRoot of ['/media', '/mnt', '/Volumes']) {
      candidates.push({ label: mountRoot, path: mountRoot });
    }
  }

  return candidates.filter(p => {
    try {
      return fs.statSync(p.path).isDirectory();
    } catch {
      return false;
    }
  });
}

function listDirectory(dir, kind) {
  const allowed = EXTENSIONS[kind] || EXTENSIONS.video;
  const entries = [];

  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.name.startsWith('.')) continue;
    const fullPath = path.join(dir, dirent.name);

    let isDir = dirent.isDirectory();
    let isFile = dirent.isFile();
    let size = null;

    // Resolve symlinks (and grab file sizes); skip anything unreadable or broken.
    if (dirent.isSymbolicLink() || isFile) {
      try {
        const stat = fs.statSync(fullPath);
        isDir = stat.isDirectory();
        isFile = stat.isFile();
        size = isFile ? stat.size : null;
      } catch {
        continue;
      }
    }

    if (isDir) {
      entries.push({ name: dirent.name, path: fullPath, type: 'dir' });
    } else if (isFile && allowed.has(path.extname(dirent.name).toLowerCase())) {
      entries.push({ name: dirent.name, path: fullPath, type: 'file', size });
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
  return entries;
}

router.get('/api/browse', (req, res) => {
  if (!isHostRequest(req)) {
    return res.status(403).json({ error: 'File browsing is only available on the host machine' });
  }

  const kind = req.query.kind === 'subtitle' ? 'subtitle' : 'video';
  const requested = typeof req.query.dir === 'string' && req.query.dir.trim() ? req.query.dir.trim() : os.homedir();
  const dir = path.resolve(requested);

  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return res.status(404).json({ error: 'Folder not found' });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Not a folder' });
  }

  let entries;
  try {
    entries = listDirectory(dir, kind);
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    return res.status(500).json({ error: 'Could not read folder' });
  }

  const parent = path.dirname(dir);
  res.json({
    path: dir,
    parent: parent === dir ? null : parent,
    kind,
    entries,
    places: getPlaces()
  });
});

module.exports = { router, isHostRequest, EXTENSIONS };
