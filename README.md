# CineSync 🍿

Self-hosted watch parties for the movies on your computer. Pick a file, and a second later you have a link your friends can open in any browser: everyone watches in sync, with chat, reactions and subtitles.

No uploads, no accounts, no port forwarding. CineSync streams straight from your machine through a Cloudflare tunnel.

## Features

- **Watch within seconds.** Choose a local `.mkv`, `.mp4` or `.avi` and the room opens about a second later. FFmpeg copies the video as-is and converts only the audio, writing short HLS chunks, so people start watching while the rest prepares in the background (typically 30–40× faster than playback). Until it's done, the seek bar shows how far you can jump.
- **Play everywhere (GPU).** HEVC and other formats don't play in every browser. Turn on *Play everywhere* to convert the video to H.264 on your GPU (VA-API: Intel and AMD on Linux) while it streams — ~13× faster than playback on an Intel Iris Xe, so the room still opens in seconds. Falls back to the CPU without a GPU.
- **In sync.** Play, pause and seek are shared over WebSockets. Late joiners start at the right moment, and everyone sees who did what ("Priya paused", "Sam jumped to 1:02:10").
- **Host & guest permissions.** The computer running CineSync is the host. Choose what guests can do — play/pause, skip around, chat, reactions — when creating the room or live during the movie. Enforced by the server.
- **Chat that stays out of the way.** A glass side panel, or in fullscreen: ambient bubbles that fade, a small floating panel, or off. Typing indicators, emoji reactions, and messages stamped with the movie time.
- **Subtitles** from the file or an external `.srt`/`.vtt`, drawn above the controls so they're always readable.
- **Theatre feel.** Edge-to-edge video with an ambient glow sampled from the movie, a pause screen with the title, and a clean minimal UI.
- **Works on phones.** Touch-friendly chat, a landscape layout, keyboard-aware chat box, and fullscreen that keeps chat on iPhone.

## Requirements

- **Node.js 20.19+** (or 22.12+)
- **FFmpeg** and **FFprobe** on your `PATH`
- *Optional, for Play everywhere on the GPU:* a VA-API driver, e.g. `intel-media-driver` (Intel) or Mesa (AMD)

Developed and tested on Linux. macOS and Windows should work for the core app but haven't been tested; GPU conversion is Linux-only for now.

## Quick start

```bash
git clone https://github.com/gillarik4-commits/cinesync.git
cd cinesync
npm install
npm start
```

Then, on the same computer:

1. Open `http://localhost:3000`.
2. Click **Choose a movie** and pick a file (or paste its path).
3. Choose audio, subtitles and what guests can do, then **Start watch party**.
4. Click **Invite** to copy the share link and send it to your friends.

The share link comes from a free Cloudflare Quick Tunnel and appears in the terminal (`CLOUDFLARE SHARE LINK: …`) a few seconds after starting. If it never appears, install `cloudflared` yourself and restart. (Newer npm versions may block the `cloudflared` package's download step; `npm install-scripts approve cloudflared` allows it.)

## Security notes

- **Anyone with the share link can join.** Share it only with people you want in the room. A new link is created each time CineSync starts.
- **Only the host can pick or change the movie.** Browsing files, preparing movies and resetting the room are refused for everyone coming through the tunnel.
- **Guest permissions are enforced on the server**, not just hidden in the page.
- CineSync serves only the prepared copy of the movie (in `media/`), never your original files or folders.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `←` `→` / `J` `L` | Back / forward 10 seconds |
| `M` | Mute |
| `C` | Subtitles |
| `F` | Fullscreen |
| `T` | Chat (in fullscreen: chat style menu) |
| `Enter` | Reply when chat shows as bubbles |

## Development

```bash
npm run dev
```

Runs the server on `:3000` (restarting on changes) and the Vite dev server on `http://localhost:5173` with hot reload; API, media and WebSocket requests are proxied to the server.

| Command | What it does |
| --- | --- |
| `npm start` | Build the frontend into `dist/` and start the server |
| `npm run dev` | Server + Vite dev server with hot reload |
| `npm run build` | Build the frontend only |
| `npm test` | Server tests (Jest) and frontend tests (Vitest) |

### How it works

1. **Setup** (`/setup.html`, host only) probes the file with FFprobe, then starts FFmpeg writing an HLS playlist of fMP4 chunks into `media/stream/`. The video is copied (or converted on the GPU), the audio becomes stereo AAC, and subtitles are extracted in parallel.
2. As soon as the first chunks exist, the room opens and everyone is sent to `/watch.html`, which plays the stream with [hls.js](https://github.com/video-dev/hls.js) (or natively on Safari).
3. A WebSocket server keeps the room in sync: play/pause/seek, chat, typing, reactions and permissions.

### Project layout

```
server.js              Express app, page routing, Cloudflare tunnel
server/
  mediaManager.js      Probe, prepare (FFmpeg → HLS), serve the movie
  syncManager.js       WebSocket room: sync, chat, presence, permissions
  permissions.js       What guests may do
  host.js              Who counts as the host
  hwaccel.js           GPU (VA-API) detection
  fileBrowser.js       Host-only folder browser
  movieInfo.js         Movie titles from file names
  routeGuard.js        Setup vs watch page redirects
client/                React + Vite frontend
  src/setup/           Host setup flow and file browser
  src/watch/           Player, chat, presence, sync
  src/shared/          Design system, hooks, React Bits components
tests/                 Server tests (Jest); client tests live next to the code (Vitest)
media/                 The prepared movie (created at runtime, git-ignored)
```

## Tech stack

- **Server:** Node.js, Express, `ws`, `fluent-ffmpeg`, Cloudflare Quick Tunnels
- **Client:** React 19, Vite, hls.js, Motion, Lucide icons, [React Bits](https://reactbits.dev/) (BlurText, ShinyText, SpotlightCard), Geist font
- **Media:** FFmpeg (HLS with fMP4 segments; VA-API H.264 encoding)

## License

[MIT](LICENSE). The React Bits components in `client/src/shared/components/reactbits/` come from [React Bits](https://reactbits.dev/) and are licensed under MIT + Commons Clause.
