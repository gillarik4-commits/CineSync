// Pure helpers for the chat feed, kept separate so they're easy to test.

export const GROUP_WINDOW_MS = 20000;
export const MAX_MESSAGES = 500;

let nextId = 1;

/**
 * Append a chat or system message. A chat message is "grouped" (no repeated
 * name/time header) when the same person spoke within the last 20s with
 * nothing in between.
 */
export function appendMessage(list, message) {
  const prev = list[list.length - 1];
  const grouped =
    message.kind === 'chat' &&
    prev?.kind === 'chat' &&
    prev.username === message.username &&
    message.timestamp - prev.timestamp <= GROUP_WINDOW_MS &&
    message.timestamp >= prev.timestamp;
  const next = [...list, { ...message, id: nextId++, grouped }];
  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
}

export function chatModeOrDefault(mode) {
  return ['ambient', 'panel', 'off'].includes(mode) ? mode : 'ambient';
}
