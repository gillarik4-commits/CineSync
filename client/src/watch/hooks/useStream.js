import { useEffect } from 'react';

const PLAYLIST = '/media/stream/index.m3u8';

/**
 * Attach the prepared movie to the <video>.
 * - 'hls': chunks streamed while preparing. hls.js (Chrome, Firefox, Android) is
 *   loaded on demand; Safari/iPhone play HLS natively.
 * - 'mp4': a movie prepared before streaming existed, served as one file.
 */
export function useStream(videoRef, source, onFatal) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return undefined;

    if (source === 'mp4') {
      video.src = '/video';
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    let hls = null;
    let cancelled = false;

    (async () => {
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          startPosition: 0, // a growing ("event") playlist would otherwise start near its end
          maxBufferLength: 30,
          backBufferLength: 90
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else onFatal?.(data);
        });
        hls.loadSource(PLAYLIST);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = PLAYLIST;
      } else {
        onFatal?.({ details: 'This browser can’t play streamed video.' });
      }
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      else {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [videoRef, source]); // eslint-disable-line react-hooks/exhaustive-deps
}
