# Music Square

A local mood-square player for your music library, like the old Samsung
TouchWiz Music Square — except it actually listens to your files instead of
relying on genre tags.

Supports MP3, M4A, FLAC, OGG Vorbis, OGG Opus, and WAV.

Two mood axes:

- **x** — calm ←→ exciting (tempo, loudness, rhythmic density)
- **y** — sad ←→ joyful (major/minor tonality, brightness)

Click anywhere on the square to drop a probe and build a mix from the
nearest-sounding tracks. Drag across the square to sweep through a path of
moods instead.

Everything runs locally — no files or audio ever leave your machine.

## 1. Install Python dependencies

Requires Python 3.10 or 3.11 (64-bit) on Windows.

You'll also need **ffmpeg** on your system PATH — it's what decodes MP3 and
M4A files (FLAC/WAV/OGG work without it, via `soundfile`). Install it with:

```
winget install ffmpeg
```

Then close and reopen your terminal, and confirm it worked with
`ffmpeg -version`. If that doesn't print a version, ffmpeg isn't on PATH yet
and MP3/M4A files will fail to analyze.

Open a terminal (PowerShell or cmd) in this folder and run:

```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

This installs `librosa` (audio analysis), `soundfile` (FLAC/WAV/OGG
decoding), `mutagen` (reads tags and cover art across all supported
formats), and `flask` (the local web server). The first install can take a
few minutes.

## 2. Analyze your library

```
python analyze_library.py "D:\Music"
```

Replace the path with your actual music folder — it scans recursively, so
subfolders are fine.

This writes `library.json` in this folder. By default, the **entire track is
analyzed from 0s** (no more sampling a short window), so on a 1000+ track
library this will take a while. Some guidance:

- It's **safe to stop with Ctrl+C and re-run later** — already-analyzed
  tracks are skipped, and progress is saved every 10 tracks.
- Use `--workers N` to control how many tracks are analyzed in parallel
  (defaults to CPU cores minus one). If your PC is busy with other things
  while this runs, lower it.
- Use `--sample-seconds 30` to only analyze the first 30 seconds of each
  track (starting at 0s) instead of the whole thing — faster, at some cost
  to accuracy.
- Re-run the same command any time you add new music — it only analyzes
  what's new.

Example for a big library on a strong CPU, analyzing only the first 45
seconds of each track for speed:

```
python analyze_library.py "D:\Music" --workers 8 --sample-seconds 45
```

## 3. Start the player

```
python server.py
```

Then open **http://127.0.0.1:8765** in your browser.

Leave the terminal window open while you use the player — it's both serving
the page and streaming your FLAC files.

## How the mood coordinates are estimated

There's no manual tagging or online lookup involved. For each track, the
script:

1. Loads the full track from 0s (or, if you passed `--sample-seconds`, the
   first N seconds from 0s instead).
2. Estimates tempo, loudness (RMS), and onset/rhythm density → combined into
   the **calm/exciting** axis.
3. Estimates major-vs-minor tonality (via chroma correlated against known
   major/minor key profiles) and spectral brightness → combined into the
   **sad/joyful** axis.
4. Positions are normalized against your *whole* library, so the square
   reflects the actual spread of your collection rather than fixed
   thresholds — a library of all metal will still spread out across the
   square relative to itself.

This is a heuristic, not a trained mood-classification model, so it won't be
perfect on every track — but it's generally good at separating "slow and
moody" from "fast and upbeat," which is really what the original Music
Square was doing too.

## Pixel-style look + real cover art

The player pulls two things straight out of your music files:

- **Embedded cover art** — extracted during analysis and cached to
  `web/art_cache/`. If a track has no embedded art, it falls back to a
  gradient monogram tile like before.
- **Real format info** — sample rate, bit depth, and actual bitrate
  (computed from file size / duration), shown next to the title like
  `44.1 kHz · 991 kbps · FLAC`.

The whole interface takes its color from whatever's playing: the app
samples the album art down to a tiny canvas, averages the pixel colors, and
derives a warm background wash plus a two-tone accent palette from it —
similar to Android's Material You dynamic color. Tracks with no art fall
back to a default warm palette.

**Because this needs the art cache, re-run the analyzer once** after
updating to pick up cover art and format info for your existing library:

```
python analyze_library.py "D:\Music"
```

Audio features aren't re-analyzed (they're cached), so this pass is much
faster than the first run — it's just extracting art and format info for
tracks it's already scored.

## Playlist Builder

Click **+ BUILD PLAYLIST** in the top bar. Search your library, add a few
tracks as "seeds," pick a playlist size, and hit Build. It finds tracks
whose mood coordinates are closest to *any one* of your seeds (not the
average of all of them), so a mixed set of seeds pulls in variety around
each one instead of collapsing toward a bland midpoint between them. The
pad highlights which tracks got pulled in after building.

## Shuffle, repeat, like

The transport bar's pill dock does real things:
- **Shuffle** — picks a random next track instead of going in queue order.
- **Repeat** — loops back to the start of the queue instead of stopping.
- **Like** (heart) — saved locally in your browser (not synced anywhere),
  purely for your own reference for now.

## Mood Shuffle

The topbar's **⊙ MOOD SHUFFLE** button opens a menu of the pad's four mood
quadrants — Mellow, Upbeat, Moody, Intense. Picking one drops a randomized
point inside that quadrant and queues the nearest tracks to it at the
current MIX SIZE, so picking the same mood twice in a row gives a different
mix each time rather than landing on a fixed spot.

## Settings

The cog icon in the topbar opens a settings panel, saved locally in your
browser so your preferences persist between sessions:

- **Music square transparency** — how see-through the mood pad's own panel
  is.
- **Panel transparency** — transparency for the topbar search field,
  sidebar/queue panel, and playlist-builder search field (independent of
  the pad's transparency above).
- **Background dimness** — layers an adjustable black overlay between the
  ambient visualizer and the UI.
- **Background visualizer on/off** — turns the blurred spectrum glow behind
  the app on or off.
- **Blur track info** — blurs the title/artist in the "now playing" card and
  every queue row; hover an entry to reveal it individually. Handy if
  you're streaming or screen-sharing and don't want your whole queue on
  display.
- **Reset to defaults** restores all of the above to the app's original
  look.

## Project layout

```
analyze_library.py   analyzes your music folder -> library.json
server.py            local web server (library API + audio streaming)
requirements.txt     Python dependencies
web/                 the player itself (HTML/CSS/JS, no build step)
library.json          generated after step 2 — your track data
```

## Troubleshooting

- **"No analyzed tracks found"** when starting the server — you haven't run
  `analyze_library.py` yet, or it's pointed at a different `library.json`.
- **A track fails to analyze** — the error is printed during the scan (e.g.
  corrupted file, 0-length audio). It's just skipped; everything else still
  works.
- **MP3/M4A files all fail** — this almost always means `ffmpeg` isn't
  installed or isn't on your PATH (see step 1). FLAC/WAV/OGG don't need it,
  but MP3/M4A decoding depends on it entirely.
- **Playback stutters on seek** — this can happen on a very slow disk with a
  huge file; the server streams directly from disk with range-request
  support, so it should be fine on a normal SSD/HDD.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for the history of fixes, changes, and
additions made to the player's UI (`index.html` / `style.css` / `app.js`),
including the files touched for each. All of it is client-side only —
markup, styling, canvas drawing, and local UI state — with no backend or
data-layer changes involved.
