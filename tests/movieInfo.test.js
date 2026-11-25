const fs = require('fs');
const os = require('os');
const path = require('path');
const { titleFromPath, saveMovieInfo, loadMovieInfo } = require('../server/movieInfo');

describe('titleFromPath', () => {
  test.each([
    ['/movies/The.Matrix.1999.1080p.BluRay.x264.mkv', 'The Matrix (1999)'],
    ['Sample Movie (2024).mkv', 'Sample Movie (2024)'],
    ['Big Test Movie.mkv', 'Big Test Movie'],
    ['dune_part_two_2160p_HDR.mkv', 'Dune Part Two'],
    ['Blade.Runner.2049.2017.2160p.mkv', 'Blade Runner 2049 (2017)'],
    ['2001.A.Space.Odyssey.1968.mkv', '2001 A Space Odyssey (1968)'],
    ['Movie.Name.[2010].WEB-DL.mp4', 'Movie Name (2010)'],
    ['1917.mkv', '1917'],
    ['1917.2019.1080p.mkv', '1917 (2019)'],
    ['C:\\Films\\Arrival.2016.mkv', 'Arrival (2016)'],
    ['the-last-of-us-abandoned-window-live-wallpaper.mp4', 'The Last Of Us Abandoned Window Live Wallpaper'],
    ['Spider-Man.Into.the.Spider-Verse.2018.mkv', 'Spider-Man Into the Spider-Verse (2018)'],
    ['', 'Untitled']
  ])('%s → %s', (input, expected) => {
    expect(titleFromPath(input)).toBe(expected);
  });
});

describe('movie info persistence', () => {
  test('saves and loads, and tolerates a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinesync-info-'));
    expect(loadMovieInfo(dir)).toBeNull();
    saveMovieInfo(dir, { title: 'Arrival (2016)', fileName: 'Arrival.2016.mkv' });
    expect(loadMovieInfo(dir)).toEqual({ title: 'Arrival (2016)', fileName: 'Arrival.2016.mkv' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
