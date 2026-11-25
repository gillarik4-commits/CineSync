const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The host is whoever is on the computer running CineSync. Requests that come
 * through the Cloudflare tunnel also arrive from localhost (cloudflared runs
 * locally), so anything carrying proxy headers counts as a guest.
 * Works for both Express requests and WebSocket upgrade requests.
 */
function isHostRequest(req) {
  const remote = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress);
  if (!LOOPBACK.has(remote)) return false;
  const h = req.headers || {};
  if (h['cf-connecting-ip'] || h['cf-ray'] || h['x-forwarded-for']) return false;
  return true;
}

/** Express middleware: only the host may continue. */
function requireHost(req, res, next) {
  if (isHostRequest(req)) return next();
  res.status(403).json({ error: 'Only the host can do that' });
}

module.exports = { isHostRequest, requireHost };
