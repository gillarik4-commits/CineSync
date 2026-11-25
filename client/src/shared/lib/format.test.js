import { describe, expect, test } from 'vitest';
import { basename, dirname, formatDuration, formatSize, formatTime, initials, userColor } from './format';

describe('formatTime', () => {
  test.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [75, '1:15'],
    [3599, '59:59'],
    [3725, '1:02:05'],
    [NaN, '0:00'],
    [Infinity, '0:00'],
    [-4, '0:00']
  ])('%p → %p', (input, out) => expect(formatTime(input)).toBe(out));
});

describe('formatDuration', () => {
  test.each([
    [6720, '1h 52m'],
    [7200, '2h'],
    [2700, '45m'],
    [40, '40s'],
    [3599, '1h'],
    [3570, '1h'],
    [3500, '58m'],
    [0, null],
    [null, null]
  ])('%p → %p', (input, out) => expect(formatDuration(input)).toBe(out));
});

test('formatSize', () => {
  expect(formatSize(512)).toBe('512 B');
  expect(formatSize(2048)).toBe('2.0 KB');
  expect(formatSize(1.5 * 1024 ** 3)).toBe('1.5 GB');
  expect(formatSize(null)).toBe('');
});

test('basename / dirname handle both separators', () => {
  expect(basename('/home/me/Movies/Film.mkv')).toBe('Film.mkv');
  expect(basename('C:\\Movies\\Film.mkv')).toBe('Film.mkv');
  expect(dirname('/home/me/Movies/Film.mkv')).toBe('/home/me/Movies');
  expect(dirname('C:\\Movies\\Film.mkv')).toBe('C:\\Movies');
  expect(dirname('/Film.mkv')).toBe('/');
  expect(dirname('Film.mkv')).toBeNull();
});

test('initials and userColor are stable', () => {
  expect(initials('eric')).toBe('E');
  expect(initials('Mary Jane Watson')).toBe('MW');
  expect(initials('   ')).toBe('?');
  expect(userColor('Priya')).toBe(userColor('Priya'));
  expect(userColor('Priya')).toMatch(/^#[0-9a-f]{6}$/i);
});
