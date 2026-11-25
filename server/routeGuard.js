const { isHostRequest } = require('./host');

/**
 * Decides where "/" and "/setup.html" go. The host gets the setup flow until a
 * movie is ready; guests always land in the watch room (which waits for the
 * host if nothing is playing yet).
 */
function createRouteGuard(appState) {
  return (req, res, next) => {
    const isEntry = req.path === '/' || req.path === '/index.html';
    if (!isEntry && req.path !== '/setup.html') return next();

    if (!isHostRequest(req)) return res.redirect('/watch.html');
    if (appState.isPartyActive) return res.redirect('/watch.html');
    if (isEntry) return res.redirect('/setup.html');
    next();
  };
}

module.exports = { createRouteGuard };
