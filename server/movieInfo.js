const fs = require('fs');
const path = require('path');

// Release-name junk that marks the end of the actual title.
const RELEASE_TOKEN =
  /\b(2160p|1440p|1080p|720p|576p|480p|4k|uhd|hdr10?|dv|x264|x265|h ?264|h ?265|hevc|avc|bluray|blu ray|brrip|bdrip|web ?dl|webrip|web|hdtv|dvdrip|remux|aac\d?|ac3|dts|ddp?\d?|atmos|10bit|8bit|proper|repack|extended|unrated|imax|yify|yts|rarbg)\b/i;
const YEAR = /(?:^|[\s([])((?:19|20)\d{2})(?=[\s)\]]|$)/;

/**
 * Turn a file name into a readable title:
 *   "The.Matrix.1999.1080p.BluRay.x264.mkv" → "The Matrix (1999)"
 *   "Sample Movie (2024).mkv"               → "Sample Movie (2024)"
 */
function titleFromPath(filePath) {
  const base = String(filePath || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]{2,4}$/i, '');
  let text = base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  // "the-last-of-us" style names use dashes as spaces.
  if (!text.includes(' ') && /[a-z]-[a-z]/i.test(text)) text = text.replace(/-+/g, ' ');
  if (!text) return 'Untitled';

  const release = RELEASE_TOKEN.exec(text);
  let cut = release ? release.index : text.length;

  // The release year is the last year-like number before the junk, and never the
  // very first word (so "2001 A Space Odyssey 1968" and "Blade Runner 2049 2017" work).
  let yearText = null;
  const years = [...text.slice(0, cut).matchAll(new RegExp(YEAR.source, 'g'))];
  const year = years.reverse().find((m) => m.index > 0 && text.slice(0, m.index).trim());
  if (year) {
    yearText = year[1];
    cut = year.index;
  }

  let title = text.slice(0, cut).replace(/[\s\-([{]+$/, '').trim();
  if (!title) return text;
  if (title === title.toLowerCase()) title = title.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  if (yearText) title = `${title} (${yearText})`;
  return title;
}

const infoPath = (mediaDir) => path.join(mediaDir, 'movie.json');

function saveMovieInfo(mediaDir, info) {
  try {
    fs.writeFileSync(infoPath(mediaDir), JSON.stringify(info));
  } catch {
    /* not fatal: the title just won't survive a restart */
  }
}

function loadMovieInfo(mediaDir) {
  try {
    const info = JSON.parse(fs.readFileSync(infoPath(mediaDir), 'utf8'));
    return info && typeof info.title === 'string' ? info : null;
  } catch {
    return null;
  }
}

module.exports = { titleFromPath, saveMovieInfo, loadMovieInfo };
