const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return null;
  }
})();

const CODEC_NAMES = {
  h264: 'H.264',
  hevc: 'HEVC (H.265)',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg4: 'MPEG-4',
  aac: 'AAC',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital Plus',
  truehd: 'Dolby TrueHD',
  dts: 'DTS',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  subrip: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  mov_text: 'MP4 text',
  webvtt: 'WebVTT',
  hdmv_pgs_subtitle: 'PGS (image)',
  dvd_subtitle: 'VobSub (image)'
};

export function languageName(code) {
  const c = String(code || '').trim();
  if (!c || c.toLowerCase() === 'unknown' || c.toLowerCase() === 'und') return 'Unknown language';
  try {
    const name = languageNames?.of(c);
    return name && name.toLowerCase() !== c.toLowerCase() && name !== 'root' ? name : c;
  } catch {
    return c;
  }
}

export function codecName(codec) {
  const c = String(codec || '').toLowerCase();
  return CODEC_NAMES[c] || c.toUpperCase();
}

/** Server labels look like "eng (aac)". Turn them into "English · AAC". */
export function prettyTrackLabel(label) {
  const match = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(String(label || ''));
  if (!match) return String(label || 'Track');
  return `${languageName(match[1])} · ${codecName(match[2])}`;
}

/** Image-based subtitle formats can't be converted to WebVTT text. */
export function isImageSubtitle(label) {
  return /pgs|dvd_subtitle|dvb_subtitle|vobsub/i.test(String(label || ''));
}

/** Video is copied as-is, so codecs some browsers can't decode are worth a heads-up. */
export function videoCompatibilityNote(codec) {
  const c = String(codec || '').toLowerCase();
  if (c === 'hevc' || c === 'h265') return 'HEVC video plays in Safari and most Chrome/Edge setups, but not in Firefox.';
  if (c && !['h264', 'av1', 'vp9', 'vp8', 'unknown'].includes(c)) return `${codecName(c)} video may not play in a browser. H.264 files work everywhere.`;
  return null;
}
