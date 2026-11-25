import { expect, test } from 'vitest';
import { deniedText, normalizePermissions, permissionChanges } from './permissions';

test('normalizePermissions keeps known booleans and fills defaults', () => {
  expect(normalizePermissions({ seek: false, extra: true, chat: 'x' })).toEqual({
    playback: true,
    seek: false,
    chat: true,
    reactions: true
  });
  expect(normalizePermissions(null)).toEqual({ playback: true, seek: true, chat: true, reactions: true });
});

test('permissionChanges describes each change for guests', () => {
  const before = { playback: true, seek: true, chat: true, reactions: true };
  expect(permissionChanges(before, { ...before, seek: false, chat: false })).toEqual([
    'The host turned off skipping for guests',
    'The host turned off chat for guests'
  ]);
  expect(permissionChanges({ ...before, playback: false }, before)).toEqual(['The host turned on pausing for guests']);
  expect(permissionChanges(before, before)).toEqual([]);
});

test('deniedText', () => {
  expect(deniedText('playback')).toMatch(/Only the host can play or pause/);
  expect(deniedText('chat')).toMatch(/turned off chat/);
  expect(deniedText('unknown')).toMatch(/host/);
});
