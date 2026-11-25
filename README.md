# CineSync 🍿

CineSync is a robust, self-hosted web application that allows you to instantly spin up synchronized, real-time watch parties for your local media library. 

Bypass port-forwarding headaches and manual transcoding. CineSync leverages zero-terminal configuration, an automated FFmpeg media pipeline, and integrated Cloudflare Tunnels to effortlessly host seamless viewing experiences for your friends over the internet.

## Key Features 🚀

- **Zero-Config Cloudflare Tunneling:** CineSync automatically spins up and intercepts a secure Cloudflare Quick Tunnel (`.trycloudflare.com`) from directly within Node.js. No manual port-forwarding or external terminals required.
- **Watch within seconds:** Pick a local `.mkv`, `.mp4` or `.avi` and the room opens about a second later. FFmpeg copies the video untouched (no re-encoding) and converts only the audio, writing short HLS chunks; everyone can start watching while the rest prepares in the background, typically 30–40× faster than playback. Until it's done, you can only jump to the part that's ready (shown on the seek bar).
- **Play everywhere (GPU):** HEVC and other formats don't play in every browser (Firefox, some phones). Turn on *Play everywhere* during setup to convert the video to H.264 on your GPU (VA-API: Intel and AMD on Linux). On an Intel Iris Xe that runs ~13× faster than playback, so the room still opens in seconds. Without a GPU it falls back to the CPU, which is much slower.
- **Sub-Second WebSocket Synchronization:** The internal sync engine enforces strict timeline lockstep. Late joiners are fed interpolated time states, and active viewers are continuously checked for timeline drift (automatically snapping them back if they drift beyond 500ms).
- **Minimal, responsive React UI:** A clean theatre view with live chat, emoji reactions, three fullscreen chat styles, in-app subtitles, keyboard shortcuts, and a phone-friendly layout.

## Prerequisites ⚙️

Ensure you have the following installed on your system before proceeding:
- **Node.js** (v18.0.0 or higher)
- **FFmpeg / FFprobe** (Available globally in your system's PATH)
- *(Optional, for Play everywhere on the GPU)* a VA-API driver, e.g. on Arch: `sudo pacman -S intel-media-driver` (Intel) or `mesa` (AMD)
- **cloudflared** (Installed globally or via npm for programmatic tunneling)

## Quick Start 🏁

1. **Install Dependencies** (from the project folder):
   ```bash
   npm install
   ```

2. **Start CineSync** (builds the web app, then starts the server):
   ```bash
   npm start
   ```

3. **Host a Party:**
   - Open `http://localhost:3000` on the computer running CineSync.
   - Click **Choose a movie** and browse to the file (or paste its path).
   - Pick the audio track and subtitles, then click **Start watch party**.
   - When it's ready, click **Invite** to copy the public link and send it to your friends.

## Host & guests 🛡️

- **The host** is whoever uses CineSync on the computer it runs on (`http://localhost:3000`). The host can always do everything, including picking or changing the movie.
- **Guests** are everyone who joins through the share link. They land straight in the watch room; if no movie is ready yet they see a waiting screen (and can already chat).
- When creating the room, the host chooses what guests can do: **play and pause**, **skip around**, **chat**, and **reactions**. These can be changed during the movie from the **Host** button in the top bar.
- Changing the movie is always host-only, because it means browsing files on the host's computer.
- Everything is enforced by the server, not just hidden in the page.

## Development 🧑‍💻

```bash
npm run dev
```

Runs the server on `:3000` (restarting on server changes) and the Vite dev server on `http://localhost:5173` with hot reload. API, video and WebSocket requests are proxied to the server.

| Command | What it does |
| --- | --- |
| `npm start` | Build the frontend into `dist/` and start the server |
| `npm run dev` | Server + Vite dev server with hot reload |
| `npm run build` | Build the frontend only |
| `npm test` | Server tests (Jest) and frontend tests (Vitest) |

### Project layout

```
server.js            Express entry: routes, Cloudflare tunnel
server/              mediaManager (ffmpeg, streaming), syncManager (WebSockets), fileBrowser
client/              React + Vite frontend (setup.html, watch.html)
  src/setup/         Host setup flow and file browser
  src/watch/         Player, chat, sync
  src/shared/        Design system, hooks, React Bits components
tests/               Server tests
media/               The prepared movie and subtitles (created at runtime, git-ignored)
```

## Keyboard shortcuts ⌨️

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `←` `→` / `J` `L` | Back / forward 10 seconds |
| `M` | Mute |
| `C` | Subtitles |
| `F` | Fullscreen |
| `T` | Chat (in fullscreen: chat style menu) |
| `Enter` | Reply (fullscreen ambient chat) |

## Technical Stack 🛠️
- **Backend:** Node.js, Express, `ws`
- **Frontend:** React 19, Vite, Motion, Lucide icons, [React Bits](https://reactbits.dev/) (BlurText, ShinyText, SpotlightCard)
- **Media Transcoding:** `fluent-ffmpeg`
- **Network Routing:** Cloudflare Quick Tunnels (Programmatic)

## License
MIT License. Free to use, modify, and distribute. React Bits components are MIT + Commons Clause.
