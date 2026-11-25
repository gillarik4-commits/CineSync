import { expect, test } from 'vitest';
import { codecName, isImageSubtitle, languageName, prettyTrackLabel, videoCompatibilityNote } from './tracks';

test('prettyTrackLabel turns ffprobe labels into readable names', () => {
  expect(prettyTrackLabel('eng (aac)')).toBe('English · AAC');
  expect(prettyTrackLabel('jpn (eac3)')).toBe('Japanese · Dolby Digital Plus');
  expect(prettyTrackLabel('Unknown (subrip)')).toBe('Unknown language · SRT');
  expect(prettyTrackLabel('weird label')).toBe('weird label');
});

test('languageName falls back to the raw code', () => {
  expect(languageName('und')).toBe('Unknown language');
  expect(languageName('xyz')).toBe('xyz');
});

test('codec helpers', () => {
  expect(codecName('h264')).toBe('H.264');
  expect(codecName('prores')).toBe('PRORES');
  expect(isImageSubtitle('eng (hdmv_pgs_subtitle)')).toBe(true);
  expect(isImageSubtitle('eng (subrip)')).toBe(false);
  expect(videoCompatibilityNote('h264')).toBeNull();
  expect(videoCompatibilityNote('hevc')).toMatch(/Firefox/);
});
