// Guest permissions, mirrored from server/permissions.js.
export const DEFAULT_PERMISSIONS = { playback: true, seek: true, chat: true, reactions: true };

export const PERMISSION_OPTIONS = [
  { key: 'playback', label: 'Play and pause', desc: 'Pause and resume for everyone' },
  { key: 'seek', label: 'Skip around', desc: 'Jump to a different time' },
  { key: 'chat', label: 'Chat', desc: 'Send messages to the room' },
  { key: 'reactions', label: 'Reactions', desc: 'Send emoji reactions' }
];

export function normalizePermissions(input) {
  const out = {};
  for (const key of Object.keys(DEFAULT_PERMISSIONS)) {
    out[key] = input && typeof input[key] === 'boolean' ? input[key] : DEFAULT_PERMISSIONS[key];
  }
  return out;
}

const OFF_TEXT = {
  playback: 'pausing',
  seek: 'skipping',
  chat: 'chat',
  reactions: 'reactions'
};

/** What changed, in words: ["The host turned off skipping for guests"]. */
export function permissionChanges(prev, next) {
  if (!prev || !next) return [];
  return Object.keys(OFF_TEXT)
    .filter((key) => prev[key] !== next[key])
    .map((key) => `The host turned ${next[key] ? 'on' : 'off'} ${OFF_TEXT[key]} for guests`);
}

const DENIED_TEXT = {
  playback: 'Only the host can play or pause right now',
  seek: 'Only the host can skip around right now',
  chat: 'The host has turned off chat',
  reactions: 'The host has turned off reactions',
  settings: 'Only the host can change room settings'
};

export function deniedText(capability) {
  return DENIED_TEXT[capability] || 'The host hasn’t allowed that';
}
