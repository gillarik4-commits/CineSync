import { formatTime } from '../shared/lib/format';

/** "Priya paused", "Priya resumed", "Priya jumped to 1:02:10". */
export function actionText({ action, by, currentTime }) {
  const who = by || 'Someone';
  if (action === 'PAUSE') return `${who} paused`;
  if (action === 'PLAY') return `${who} resumed`;
  if (action === 'SEEK') return `${who} jumped to ${formatTime(currentTime)}`;
  return null;
}

/** "Priya is typing", "Priya and Sam are typing", "Priya, Sam and Ana are typing", "4 people are typing". */
export function typingText(names) {
  const list = [...new Set(names)].filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return `${list[0]} is typing`;
  if (list.length === 2) return `${list[0]} and ${list[1]} are typing`;
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]} are typing`;
  return `${list.length} people are typing`;
}

/** Who paused, for the pause screen. `by` null means it was you. */
export function pausedByText(actor, me) {
  if (!actor || actor.action !== 'PAUSE') return 'Paused';
  if (!actor.by || actor.by === me) return 'You paused';
  return `Paused by ${actor.by}`;
}

/**
 * Add a toast, merging rapid repeats from the same person (e.g. tapping
 * forward five times) into one updating toast instead of a pile.
 */
export function pushToast(toasts, toast, now = Date.now(), max = 3) {
  const last = toasts[toasts.length - 1];
  if (last && last.key === toast.key && now - last.at < 2500) {
    return [...toasts.slice(0, -1), { ...last, text: toast.text, at: now, bump: (last.bump || 0) + 1 }];
  }
  return [...toasts, { ...toast, at: now }].slice(-max);
}
