<img width="2504" height="1565" alt="Music Square Logo" src="https://github.com/user-attachments/assets/5fe6edbc-98b0-425c-b0b5-9a11a3ff870c" />

# Music Square

A local mood-square player for your FLAC library — like the old Samsung
TouchWiz Music Square, except it actually *listens* to your files instead of
relying on genre tags or online metadata.

Two mood axes:

- **x** — calm ←→ exciting (tempo, loudness, rhythmic density)
- **y** — sad ←→ joyful (major/minor tonality, spectral brightness)

Click anywhere on the square to drop a probe and build a mix from the
nearest-sounding tracks. Drag across the square to sweep through a path of
moods instead of a single point. Scroll to zoom in and out (centered on your
cursor), or use the +/−/reset buttons in the corner of the pad — handy once
you've got enough tracks that points start overlapping.

Everything runs locally — no files, tags, or audio ever leave your machine.
There's no cloud lookup, no telemetry, and no internet connection required
once your library is analyzed.

---

## Requirements

- Windows, with **Python 3.10 or 3.11 (64-bit)**
- A folder of `.flac` files (other formats aren't scanned yet)
- A modern browser (Chrome, Edge, Firefox)

## 1. Install Python dependencies

Open a terminal (PowerShell or cmd) in this folder and run:

```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

This installs:

| Package    | Purpose                                  |
|------------|-------------------------------------------|
| `librosa`  | Audio analysis (tempo, tonality, timbre) |
| `soundfile`| FLAC decoding + real format info          |
| `mutagen`  | Reads title/artist/album tags + cover art |
| `flask`    | The local web server                      |

The first install can take a few minutes (librosa pulls in a fair number of
scientific-computing dependencies).

## 2. Analyze your library

```
python analyze_library.py "D:\Music"
```

Replace the path with your actual music folder — it scans recursively, so
subfolders are fine.

This writes `library.json` in this folder. On a 1000+ track library this
will take a while (analysis samples ~60 seconds of audio per track, taken
from around 30% into each file). Some guidance:

- **Safe to stop with `Ctrl+C` and re-run later.** Already-analyzed tracks
  are skipped (matched by path, file size, and modified time), and progress
  is saved every 10 tracks.
- Use `--workers N` to control how many tracks are analyzed in parallel
  (defaults to CPU cores minus one). Lower it if your PC is busy with other
  things while this runs.
- Use `--sample-seconds 30` to analyze less audio per track and speed things
  up, at some cost to accuracy.
- Re-run the same command any time you add new music — it only analyzes
  what's new.
- If a worker process crashes on a bad file, the analyzer automatically
  falls back to a slower, crash-isolated one-file-at-a-time mode for the
  rest of the batch, so one corrupt track can't take down the whole run.

Example for a big library on a strong CPU:

```
python analyze_library.py "D:\Music" --workers 8 --sample-seconds 45
```

### Debugging a specific file

If a track keeps failing, you can run the analyzer on it directly (no
worker subprocess, so real errors aren't swallowed):

```
python analyze_library.py --debug-file "D:\Music\Artist\weird_track.flac"
```

This prints a checkpoint before each analysis step, so if it dies silently
you'll know exactly which step it died on. You can also skip individual
steps to isolate the problem, e.g.:

```
python analyze_library.py --debug-file "D:\Music\Artist\weird_track.flac" --debug-skip beat_track
```

## 3. Start the player

```
python server.py
```

Then open **http://127.0.0.1:8765** in your browser.

Leave the terminal window open while you use the player — it's both serving
the page and streaming your FLAC files. The server also prints a network
address (e.g. `http://192.168.x.x:8765`) — open that on your phone if it's
on the same Wi-Fi/LAN.

Optional flags:

```
python server.py --library my.json --port 9000
```

---

## How the mood coordinates are estimated

There's no manual tagging or online lookup involved — everything comes from
listening to the audio itself. Here's exactly how, stage by stage.

This is a heuristic, not a trained mood-classification model, so it won't be
perfect on every track — but it's generally good at separating "slow and
moody" from "fast and upbeat," which is really what the original Music
Square was doing too.

### 1. Picking what audio to sample

For each file:

- `librosa.get_duration()` reads just the duration, without decoding the
  whole file.
- It then picks a **30%-in offset**: `offset = duration * 0.3`, but only if
  the track is long enough (`duration > sample_seconds * 1.5`, i.e. > 90s by
  default) — otherwise it starts at 0. This skips cold intros/silence on
  normal-length tracks while avoiding weird offsets on short files.
- It loads at most `sample_seconds` (default 60s) of audio starting from
  that offset, downsampled to **22,050 Hz, mono**
  (`librosa.load(..., sr=22050, mono=True)`). Mono + a lower sample rate is
  plenty for tempo/tonality analysis and keeps things fast.
- If the resulting clip is under 1 second of audio, it's treated as
  broken/silent and skipped.

### 2. Raw feature extraction (per track)

From that ~60-second mono clip, five raw numbers get computed:

| Feature | How it's computed | What it captures |
|---|---|---|
| **Tempo** | `librosa.feature.tempo()` on the onset-strength envelope → estimated BPM. Falls back to 120.0 if detection errors out. | Speed/pace |
| **RMS** | Mean of `librosa.feature.rms()` — root-mean-square amplitude over time | Loudness/energy |
| **Onset rate** | Mean of the onset-strength envelope itself (`librosa.onset.onset_strength()`) | Rhythmic density — how busy/percussive the track is, not just its BPM |
| **Spectral centroid** | Mean of `librosa.feature.spectral_centroid()` — the "center of mass" of the frequency spectrum | Brightness/timbre — bright/harsh vs. warm/dark |
| **Mode score** | See below | Major vs. minor tonality |

**Mode score in detail:** it computes a **chroma vector**
(`librosa.feature.chroma_cqt()`), which folds all pitched energy in the clip
into 12 bins — one per pitch class (C, C#, D, ... B) — regardless of octave,
then averages that over time and L2-normalizes it. That 12-dimensional
profile is then compared (via dot product / cosine similarity) against two
fixed reference vectors: the **Krumhansl-Schmuckler major and minor key
profiles** — empirically-derived templates of how strongly each pitch class
"belongs" in a major vs. minor key, based on music-perception research.
`mode_score = major_correlation - minor_correlation`, so positive = leans
major-sounding, negative = leans minor-sounding.

Alongside this, it also grabs **tags** (title/artist/album via mutagen),
**cover art** (embedded picture, or a `cover.jpg`/`folder.jpg`/etc. in the
same folder), and **real format info** (sample rate, bit depth, and a
computed bitrate from file size ÷ duration) — none of which feed into the
mood coordinates, they're just for display.

### 3. Turning raw features into x/y coordinates (library-wide)

This is the important part: a single track's raw numbers mean nothing on
their own — "loud" or "bright" is relative to the rest of your library. So
after every track in the batch is analyzed, `recompute_coordinates()` runs
across the *whole* library at once:

1. **Z-score each raw feature** across all tracks:
   `(value - library_mean) / library_stddev`, for tempo, RMS, onset rate,
   centroid, and mode score separately. This puts everything on a
   comparable scale (roughly -3 to +3, centered on 0) regardless of the
   feature's original units.
2. **Weighted-combine into two axes:**
   - `arousal_z = 0.45·tempo_z + 0.35·rms_z + 0.20·onset_z` → becomes the
     **x-axis (calm ↔ exciting)**. Tempo dominates, loudness matters
     somewhat less, rhythmic density least.
   - `valence_z = 0.55·mode_z + 0.45·centroid_z` → becomes the **y-axis
     (sad ↔ joyful)**. Major/minor tonality is weighted slightly more than
     brightness.
3. **Compress to -1..+1** with `tanh(z / 1.6)`. The `tanh` squashes
   outliers gently instead of clipping them hard, and dividing by 1.6
   before squashing controls how "spread out" typical tracks land versus
   how quickly extreme ones saturate toward the edges of the square.

The final `x, y` (rounded to 4 decimals) are what gets written to
`library.json` and what the web player plots directly.

### Why this design choice matters

Because normalization is relative to *your* library, a collection of all
death metal will still spread across the whole square (some tracks will
look "calm" and "joyful" *relative to the rest of your death metal*) —
there's no absolute "120 BPM = exciting" threshold. The trade-off:
**coordinates shift slightly every time you add new music**, since the
mean/stddev of the whole library changes. That's why
`recompute_coordinates()` re-runs over *all* cached tracks (not just
newly-analyzed ones) every time you re-run the analyzer.

## Cover art + real format info

The analyzer also pulls two things straight out of your files:

- **Cover art** — tries the picture embedded in the FLAC's own tags first,
  then falls back to a `cover.jpg` / `folder.jpg` / `front.jpg` /
  `album.jpg` (or `.png`) sitting in the same folder, and finally to a
  gradient monogram tile if nothing is found. Extracted art is cached to
  `web/art_cache/`.
- **Real format info** — sample rate, bit depth, and actual bitrate
  (computed from file size ÷ duration), shown next to the title like
  `44.1 kHz · 991 kbps · FLAC`.

On top of that server-side cache, the web player also caches artwork in
your browser (via the Cache Storage API) the first time it loads each
image, so on later visits or page reloads thumbnails come back instantly
from your browser's own cache instead of re-fetching and popping in one by
one. This is separate from — and in addition to — `web/art_cache/`, and
stays entirely on your machine like everything else.

The whole interface takes its color from whatever's playing: the app
samples the album art down to a tiny canvas, averages the pixel colors, and
derives a warm background wash plus a two-tone accent palette from it —
similar to Android's Material You dynamic color. Tracks with no art fall
back to a default warm palette.

Tracks analyzed before this feature existed will be missing art/format
info — just re-run `analyze_library.py` on your library folder. Audio
features aren't re-analyzed for already-scored tracks (they're cached), so
this pass is much faster than the first run; it's just extracting art and
format info.

## The pad

Tracks are plotted as their own album art, clipped to a small circle, so you
can actually recognize what's what at a glance instead of staring at plain
dots. Tracks without usable art — or whose art hasn't finished loading yet —
fall back to a small dot colored by their mood coordinates, and upgrade to
the real thumbnail automatically the moment it's ready (no flicker, no
reload needed).

Whatever's currently in your queue is ringed in the app's current accent
color, with a slightly thicker ring around the track that's actually
playing, so you can find "what's queued/playing" among everything else on
the pad at a glance.

**Zoom:** scroll to zoom in and out, centered on wherever your cursor is —
or use the +/−/reset buttons in the corner of the pad. Picking a track from
the queue list smoothly pans the pad to it if you're zoomed in, so you don't
lose track of where the currently-playing track actually lives on the
square.

## Playlist Builder

Click **+ BUILD PLAYLIST** in the top bar. Search your library, add a few
tracks as "seeds," pick a playlist size, and hit Build. It finds tracks
whose mood coordinates are closest to *any one* of your seeds (not the
average of all of them), so a mixed set of seeds pulls in variety around
each one instead of collapsing toward a bland midpoint between them. The
pad highlights which tracks got pulled in after building.

## Transport controls

The transport bar's pill dock does real things:

- **Shuffle** — picks a random next track instead of going in queue order.
- **Repeat** — loops back to the start of the queue instead of stopping.
- **Like** (heart) — saved locally in your browser (not synced anywhere),
  purely for your own reference for now.

The queue list (right-hand panel) shows each track's album art too, with the
same mood-dot fallback as the pad.

**Media keys / OS controls** — play, pause, previous, and next also work
from your keyboard's media keys, a headset's buttons, and your OS's
lock-screen or notification media controls, via the browser's Media Session
API. The current track's title, artist, and art show up there too, and
scrubbing from the lock screen stays in sync with the in-app seek bar.

---

## Project structure

```
analyze_library.py   analyzes your FLAC folder -> library.json
server.py            local web server (library API + audio streaming)
requirements.txt     Python dependencies
web/                 the player itself (HTML/CSS/JS, no build step)
  index.html
  style.css
  app.js
  art_cache/          extracted cover art (generated)
library.json          generated after step 2 — your track data
```

## Troubleshooting

- **"No analyzed tracks found"** when starting the server — you haven't run
  `analyze_library.py` yet, or it's pointed at a different `library.json`.
- **A track fails to analyze** — the error is printed during the scan (e.g.
  corrupted file, 0-length audio). It's just skipped; everything else still
  works. Use `--debug-file` (see above) to see exactly what's going wrong.
- **A worker process crashed mid-batch** — the analyzer automatically
  retries the remaining files one at a time in a crash-isolated mode.
  If it fails immediately even in that mode, try `--workers 1` and check
  that antivirus isn't interfering with the `python.exe` worker processes.
- **Playback stutters on seek** — this can happen on a very slow disk with a
  huge FLAC file; the server streams directly from disk with range-request
  support, so it should be fine on a normal SSD/HDD.

## Privacy

Nothing here calls out to the internet — no cloud lookups, no telemetry, no
outbound requests of any kind. Analysis, playback, and the "liked" list are
all local to your machine and browser.

That said, "local" isn't the same as "only reachable from this machine."
There are two separate things in `server.py` worth knowing about:

- **`host="0.0.0.0"`** binds the server to every network interface, not
  just `127.0.0.1`. That's by design — it's what lets you open the printed
  "Network" address on your phone over the same Wi-Fi/LAN — but it also
  means **anyone else on that same network can reach your library and
  stream your files** directly by IP for as long as the server is running,
  since there's no authentication in front of it.
- **`CORS(app)`** is called with no restrictions, which makes flask-cors
  allow *any* origin by default. In practice this means any website's
  JavaScript running in a tab on your machine — not just this player's own
  page — could make a request to `127.0.0.1:8765` (or your LAN IP) and read
  your library data or pull an audio file, while the server is running.
  This is the same class of risk as other unauthenticated local dev
  servers with permissive CORS.

If either of those matter to you (e.g. you're on a shared/untrusted
network, or you keep this running in the background while browsing), you
can:

- restrict the bind to this machine only by changing `host="0.0.0.0"` to
  `host="127.0.0.1"` in `server.py` (you'll lose phone/LAN access), and/or
- lock down `CORS(app)` to just the origins you actually need, e.g.
  `CORS(app, origins=["http://127.0.0.1:8765"])`, instead of leaving it
  wide open.
