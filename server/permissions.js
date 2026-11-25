// What guests (everyone but the host) may do. The host can always do everything.
const DEFAULT_PERMISSIONS = Object.freeze({
  playback: true, // play and pause
  seek: true, // jump around and skip
  chat: true,
  reactions: true
});

const KEYS = Object.keys(DEFAULT_PERMISSIONS);

let current = { ...DEFAULT_PERMISSIONS };

/** Keep only known keys, as booleans; anything missing falls back to the default. */
function normalizePermissions(input) {
  const out = {};
  for (const key of KEYS) {
    out[key] = input && typeof input[key] === 'boolean' ? input[key] : DEFAULT_PERMISSIONS[key];
  }
  return out;
}

function getPermissions() {
  return { ...current };
}

function setPermissions(input) {
  current = normalizePermissions({ ...current, ...input });
  return getPermissions();
}

function resetPermissions() {
  current = { ...DEFAULT_PERMISSIONS };
}

/** The capability a sync action needs. */
function capabilityForAction(action) {
  if (action === 'PLAY' || action === 'PAUSE') return 'playback';
  if (action === 'SEEK') return 'seek';
  return null;
}

function can(isHost, capability) {
  if (isHost) return true;
  return Boolean(current[capability]);
}

module.exports = {
  DEFAULT_PERMISSIONS,
  normalizePermissions,
  getPermissions,
  setPermissions,
  resetPermissions,
  capabilityForAction,
  can
};
