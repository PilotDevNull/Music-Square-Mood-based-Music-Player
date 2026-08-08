# Music Square

A local mood-square player for your FLAC library, like the old Samsung
TouchWiz Music Square — except it actually listens to your files instead of
relying on genre tags.

Two mood axes:

- **x** — calm ←→ exciting (tempo, loudness, rhythmic density)
- **y** — sad ←→ joyful (major/minor tonality, brightness)

Click anywhere on the square to drop a probe and build a mix from the
nearest-sounding tracks. Drag across the square to sweep through a path of
moods instead.

Everything runs locally — no files or audio ever leave your machine.

## 1. Install Python dependencies

Requires Python 3.10 or 3.11 (64-bit) on Windows.

Open a terminal (PowerShell or cmd) in this folder and run:

```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

This installs `librosa` (audio analysis), `soundfile` (FLAC decoding),
`mutagen` (reads title/artist/album tags), and `flask` (the local web
server). The first install can take a few minutes.

## 2. Analyze your library

```
python analyze_library.py "D:\Music"
```

Replace the path with your actual music folder — it scans recursively, so
subfolders are fine.

This writes `library.json` in this folder. On a 1000+ track library this
will take a while (analysis samples ~60 seconds of audio per track). Some
guidance:

- It's **safe to stop with Ctrl+C and re-run later** — already-analyzed
  tracks are skipped, and progress is saved every 10 tracks.
- Use `--workers N` to control how many tracks are analyzed in parallel
  (defaults to CPU cores minus one). If your PC is busy with other things
  while this runs, lower it.
- Use `--sample-seconds 30` to analyze less audio per track and speed things
  up, at some cost to accuracy.
- Re-run the same command any time you add new music — it only analyzes
  what's new.

Example for a big library on a strong CPU:

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

1. Loads a ~60 second sample from around 30% into the track (skips cold
   intros, avoids analyzing the whole file for speed).
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

## What's new: Pixel-style look + real cover art

The player now pulls two things straight out of your FLAC files that it
wasn't using before:

- **Embedded cover art** — extracted during analysis and cached to
  `web/art_cache/`. If a track has no embedded art, it falls back to a
  gradient monogram tile like before.
- **Real format info** — sample rate, bit depth, and actual bitrate
  (computed from file size / duration), shown next to the title like
  `44.1 kHz · 991 kbps · FLAC`.

The whole interface now takes its color from whatever's playing: the app
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

## New: Playlist Builder

Click **+ BUILD PLAYLIST** in the top bar. Search your library, add a few
tracks as "seeds," pick a playlist size, and hit Build. It finds tracks
whose mood coordinates are closest to *any one* of your seeds (not the
average of all of them), so a mixed set of seeds pulls in variety around
each one instead of collapsing toward a bland midpoint between them. The
pad highlights which tracks got pulled in after building.

## New: shuffle, repeat, like

The transport bar's pill dock now does real things:
- **Shuffle** — picks a random next track instead of going in queue order.
- **Repeat** — loops back to the start of the queue instead of stopping.
- **Like** (heart) — saved locally in your browser (not synced anywhere),
  purely for your own reference for now.



```
analyze_library.py   analyzes your FLAC folder -> library.json
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
- **Playback stutters on seek** — this can happen on a very slow disk with a
  huge FLAC; the server streams directly from disk with range-request
  support, so it should be fine on a normal SSD/HDD.
