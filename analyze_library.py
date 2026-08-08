"""
Music Square analyzer.

Scans a folder of FLAC files, estimates two mood coordinates per track:

    x  calm (-1)  <-->  exciting (+1)      "arousal"
    y  sad  (-1)  <-->  joyful   (+1)      "valence"

and writes everything to library.json for the web player to use.

Safe to interrupt (Ctrl+C) and re-run: files already analyzed (matched by
path + size + mtime) are skipped, and progress is saved every few tracks.

Usage:
    python analyze_library.py "D:/Music"
    python analyze_library.py "D:/Music" --workers 6 --sample-seconds 60
"""
import argparse
import hashlib
import json
import os
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

import numpy as np

# Krumhansl-Schmuckler key profiles, used to guess major vs minor tonality.
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

AUDIO_EXTS = {".flac"}


def track_id(rel_path: str) -> str:
    return hashlib.md5(rel_path.encode("utf-8")).hexdigest()[:16]


def file_signature(path: Path) -> str:
    st = path.stat()
    return f"{st.st_size}-{int(st.st_mtime)}"


def read_tags(path: Path):
    title, artist, album = path.stem, "Unknown Artist", "Unknown Album"
    try:
        from mutagen.flac import FLAC
        f = FLAC(str(path))
        title = (f.get("title", [title]) or [title])[0]
        artist = (f.get("artist", [artist]) or [artist])[0]
        album = (f.get("album", [album]) or [album])[0]
    except Exception:
        pass
    return title, artist, album


COVER_FILENAMES = [
    "cover.jpg", "cover.jpeg", "cover.png",
    "folder.jpg", "folder.jpeg", "folder.png",
    "front.jpg", "front.jpeg", "front.png",
    "album.jpg", "albumart.jpg",
]


def extract_art(path: Path, tid: str, art_dir: Path):
    """Pulls cover art for a track: first tries the picture embedded in the
    FLAC's own tags, then falls back to a cover image file sitting in the
    same folder (common for rips that don't embed art). Returns the cached
    file's extension, or None if nothing was found."""
    try:
        from mutagen.flac import FLAC
        f = FLAC(str(path))
        if f.pictures:
            pic = f.pictures[0]
            mime = (pic.mime or "").lower()
            ext = "png" if "png" in mime else "jpg"
            art_dir.mkdir(parents=True, exist_ok=True)
            (art_dir / f"{tid}.{ext}").write_bytes(pic.data)
            return ext
    except Exception:
        pass

    try:
        folder = path.parent
        by_lower = {p.name.lower(): p for p in folder.iterdir() if p.is_file()}
        for name in COVER_FILENAMES:
            src = by_lower.get(name)
            if src:
                ext = "png" if src.suffix.lower() == ".png" else "jpg"
                art_dir.mkdir(parents=True, exist_ok=True)
                (art_dir / f"{tid}.{ext}").write_bytes(src.read_bytes())
                return ext
    except Exception:
        pass

    return None


def analyze_one(path_str: str, sample_seconds: int, tid: str, art_dir_str: str, sr: int = 22050):
    """Runs in a worker process. Returns a dict of raw features, or {'error': ...}."""
    import librosa
    import soundfile as sf

    path = Path(path_str)
    art_dir = Path(art_dir_str)
    try:
        dur = librosa.get_duration(path=str(path))

        if sample_seconds <= 0:
            y, _sr = librosa.load(
                str(path),
                sr=sr,
                mono=True
            )
        else:
            offset = dur * 0.3 if dur > sample_seconds * 1.5 else 0.0
            y, _sr = librosa.load(
                str(path),
                sr=sr,
                mono=True,
                offset=offset,
                duration=min(sample_seconds, dur)
            )
        if y.size < sr:  # less than 1s of audio, something's wrong
            raise ValueError("clip too short / silent")
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)

        try:
            tempo = librosa.feature.tempo(
                onset_envelope=onset_env,
                sr=sr
            )
            tempo = float(np.atleast_1d(tempo)[0])
        except Exception:
            tempo = 120.0

        rms = float(np.mean(librosa.feature.rms(y=y)))
        onset_rate = float(np.mean(onset_env))

        centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))

        chroma = np.mean(librosa.feature.chroma_cqt(y=y, sr=sr), axis=1)
        chroma_n = chroma / (np.linalg.norm(chroma) + 1e-9)
        major_corr = float(np.dot(chroma_n, MAJOR_PROFILE / np.linalg.norm(MAJOR_PROFILE)))
        minor_corr = float(np.dot(chroma_n, MINOR_PROFILE / np.linalg.norm(MINOR_PROFILE)))
        mode_score = major_corr - minor_corr

        title, artist, album = read_tags(path)
        art_ext = extract_art(path, tid, art_dir)

        # real file format info, for display (sample rate / bitrate / bit depth)
        try:
            info = sf.info(str(path))
            samplerate = int(info.samplerate)
            subtype = (info.subtype or "")
            bit_depth = 24 if "24" in subtype else (32 if "32" in subtype else 16)
        except Exception:
            samplerate, bit_depth = 44100, 16
        filesize = path.stat().st_size
        bitrate_kbps = round(filesize * 8 / dur / 1000) if dur > 0 else 0

        return {
            "ok": True,
            "tempo": tempo,
            "rms": rms,
            "onset_rate": onset_rate,
            "centroid": centroid,
            "mode_score": mode_score,
            "duration": float(dur),
            "title": title,
            "artist": artist,
            "album": album,
            "art_ext": art_ext,
            "samplerate": samplerate,
            "bit_depth": bit_depth,
            "bitrate_kbps": bitrate_kbps,
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def zscore(values):
    arr = np.array(values, dtype=float)
    mu, sd = arr.mean(), arr.std()
    if sd < 1e-9:
        return np.zeros_like(arr)
    return (arr - mu) / sd


def recompute_coordinates(entries: dict):
    """Recomputes x/y mood coordinates for every analyzed track, using the
    whole library's distribution so positions stay comparable to each other."""
    ok_ids = [k for k, v in entries.items() if v.get("ok")]
    if not ok_ids:
        return

    tempo_z = zscore([entries[i]["tempo"] for i in ok_ids])
    rms_z = zscore([entries[i]["rms"] for i in ok_ids])
    onset_z = zscore([entries[i]["onset_rate"] for i in ok_ids])
    centroid_z = zscore([entries[i]["centroid"] for i in ok_ids])
    mode_z = zscore([entries[i]["mode_score"] for i in ok_ids])

    arousal_z = 0.45 * tempo_z + 0.35 * rms_z + 0.20 * onset_z
    valence_z = 0.55 * mode_z + 0.45 * centroid_z

    x = np.tanh(arousal_z / 1.6)
    y = np.tanh(valence_z / 1.6)

    for idx, tid in enumerate(ok_ids):
        entries[tid]["x"] = round(float(x[idx]), 4)
        entries[tid]["y"] = round(float(y[idx]), 4)


def run_analysis(todo, args, art_dir, tracks, out_path, data):
    """Runs analyze_one over every job in `todo`, saving progress as it goes.

    Uses a normal multi-worker pool for speed. If a worker process dies
    outright (segfault in a native audio library, a malformed file, etc.),
    concurrent.futures marks the *whole pool* broken - every other pending
    result, even ones that never actually ran, raises the same error. Left
    unhandled, one bad file wipes out results for everything queued behind
    it. When that happens here, we drop into a slower but crash-proof mode:
    a fresh single-worker pool per remaining file with a timeout, so a
    single bad file only costs that one file instead of the whole run.
    """
    start = time.time()
    total = len(todo)
    done = 0
    errors = 0
    finished_ids_all = set()  # tracks completed *in this run*, not stale entries from prior runs

    def record(tid, rel, sig, result):
        nonlocal done, errors
        result["sig"] = sig
        result["rel_path"] = rel
        tracks[tid] = result
        finished_ids_all.add(tid)
        done += 1
        if not result.get("ok"):
            errors += 1
            print(f"  [skip] {rel} -> {result.get('error')}")
        if done % 25 == 0 or done == total:
            elapsed = time.time() - start
            rate = done / elapsed if elapsed > 0 else 0
            remaining = (total - done) / rate if rate > 0 else 0
            print(f"  {done}/{total}  ({rate:.2f} tracks/sec, ~{remaining/60:.1f} min left)")
        if done % args.save_every == 0:
            recompute_coordinates(tracks)
            out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    remaining = list(todo)

    # --- fast bulk mode ---
    while remaining:
        try:
            with ProcessPoolExecutor(max_workers=args.workers) as pool:
                futures = {
                    pool.submit(analyze_one, path_str, args.sample_seconds, tid, str(art_dir)): (tid, rel, sig)
                    for tid, rel, path_str, sig in remaining
                }
                for fut in as_completed(futures):
                    tid, rel, sig = futures[fut]
                    result = fut.result()  # if the pool is broken, this raises and we jump to except below
                    record(tid, rel, sig, result)
            remaining = [j for j in remaining if j[0] not in finished_ids_all]
        except BrokenProcessPool:
            remaining = [j for j in remaining if j[0] not in finished_ids_all]
            print(f"\n[!] A worker process crashed (almost always one unusual/corrupt file), "
                  f"which knocks out the whole batch it was part of.")
            print(f"    Switching to safe one-file-at-a-time mode for the remaining "
                  f"{len(remaining)} tracks - slower, but immune to this.\n")
            if not finished_ids_all:
                print("    [!] Note: this crashed before ANY track succeeded. If safe mode below "
                      "also fails immediately on the very first file, that points to a setup "
                      "problem (not a bad file) - try re-running with --workers 1 to confirm, "
                      "and check antivirus isn't interfering with the python.exe worker "
                      "processes.\n")
            break

    # --- safe, crash-isolated mode for whatever bulk mode couldn't finish ---
    for tid, rel, path_str, sig in remaining:
        try:
            with ProcessPoolExecutor(max_workers=1) as pool:
                fut = pool.submit(analyze_one, path_str, args.sample_seconds, tid, str(art_dir))
                result = fut.result(timeout=180)
        except BrokenProcessPool:
            result = {"ok": False, "error": "crashed the analyzer process (corrupt/unsupported file) - skipped"}
        except FutureTimeoutError:
            result = {"ok": False, "error": "timed out after 180s - skipped"}
        except Exception as e:
            result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        record(tid, rel, sig, result)

    recompute_coordinates(tracks)
    out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return done, errors


def debug_analyze_one(path_str: str, sample_seconds: int, tid: str, art_dir_str: str, sr: int = 22050, skip=None):
    """Same steps as analyze_one, but prints a checkpoint before each one and
    flushes immediately, so if the process dies silently (no traceback), the
    last printed line tells you exactly which step it died on. Pass a set of
    step names in `skip` to bypass specific steps (e.g. {'beat_track'}) and
    see whether later steps survive."""
    skip = skip or set()

    def step(msg):
        print(f"  [step] {msg}", flush=True)

    path = Path(path_str)
    art_dir = Path(art_dir_str)

    step(f"file: {path}")
    step(f"file exists: {path.is_file()}, size: {path.stat().st_size if path.is_file() else 'N/A'} bytes")

    step("importing librosa...")
    import librosa
    step("importing soundfile...")
    import soundfile as sf
    step("imports OK")

    step("reading duration (librosa.get_duration)...")
    dur = librosa.get_duration(path=str(path))
    step(f"duration: {dur:.2f}s")

    offset = dur * 0.3 if dur > sample_seconds * 1.5 else 0.0
    step(f"loading audio (librosa.load), offset={offset:.2f}s, duration={min(sample_seconds, dur):.2f}s...")
    y, _sr = librosa.load(str(path), sr=sr, mono=True, offset=offset, duration=min(sample_seconds, dur))
    step(f"loaded {y.size} samples")

    if y.size < sr:
        step("!! clip too short/silent - would be skipped normally")
        return

    if "beat_track" in skip:
        step("SKIPPING beat_track (--debug-skip beat_track)")
    else:
        step("running beat_track (tempo detection, numba-accelerated)...")
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        step(f"tempo: {float(np.atleast_1d(tempo)[0]):.1f} BPM")

    step("computing RMS (loudness)...")
    rms = float(np.mean(librosa.feature.rms(y=y)))
    step(f"rms: {rms:.4f}")

    if "onset_strength" in skip:
        step("SKIPPING onset_strength (--debug-skip onset_strength)")
    else:
        step("computing onset strength (numba-accelerated)...")
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        step(f"onset_rate: {float(np.mean(onset_env)):.4f}")

    step("computing spectral centroid (brightness)...")
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    step(f"centroid: {centroid:.1f}")

    if "chroma_cqt" in skip:
        step("SKIPPING chroma_cqt (--debug-skip chroma_cqt)")
    else:
        step("computing chroma_cqt (key/tonality, numba-accelerated)...")
        chroma = np.mean(librosa.feature.chroma_cqt(y=y, sr=sr), axis=1)
        step("chroma OK")

    step("reading tags (mutagen)...")
    title, artist, album = read_tags(path)
    step(f"tags: {title} / {artist} / {album}")

    step("extracting art (mutagen)...")
    art_ext = extract_art(path, tid, art_dir)
    step(f"art_ext: {art_ext}")

    step("reading format info (soundfile.info)...")
    info = sf.info(str(path))
    step(f"samplerate: {info.samplerate}, subtype: {info.subtype}")

    step("ALL STEPS COMPLETED SUCCESSFULLY - this file analyzes fine on its own.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("library_dir", nargs="?", help="Folder to scan recursively for .flac files")
    ap.add_argument("--output", default="library.json", help="Output JSON path (default: library.json)")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 1))
    ap.add_argument("--sample-seconds", type=int, default=60, help="Seconds of audio analyzed per track")
    ap.add_argument("--save-every", type=int, default=10)
    ap.add_argument("--debug-file", metavar="PATH",
                     help="Analyze exactly one file directly in this process, with no worker "
                          "subprocess involved. Use this to see the real crash/traceback when "
                          "every file fails with 'crashed the analyzer process' - it'll either "
                          "print the actual Python error, or the crash will happen right in "
                          "this terminal instead of being swallowed by the worker pool.")
    ap.add_argument("--debug-skip", action="append", default=[],
                     help="Used with --debug-file: skip a named step (e.g. --debug-skip "
                          "beat_track) to see whether later steps survive. Can be passed "
                          "multiple times.")
    args = ap.parse_args()

    if args.debug_file:
        art_dir = Path(__file__).resolve().parent / "web" / "art_cache"
        art_dir.mkdir(parents=True, exist_ok=True)
        print(f"Analyzing {args.debug_file} directly (no subprocess)...")
        debug_analyze_one(args.debug_file, args.sample_seconds, "debug", str(art_dir), skip=set(args.debug_skip))
        return

    root = Path(args.library_dir).resolve() if args.library_dir else None
    if root is None:
        ap.error("library_dir is required (unless using --debug-file)")
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    out_path = Path(args.output).resolve()
    data = {"root": str(root), "tracks": {}}
    if out_path.exists():
        try:
            data = json.loads(out_path.read_text(encoding="utf-8"))
            if data.get("root") != str(root):
                print(f"[!] library.json was built from a different root ({data.get('root')}); "
                      f"continuing anyway, ids are path-based so this is safe.")
        except Exception:
            print("[!] Could not read existing library.json, starting fresh.")
            data = {"root": str(root), "tracks": {}}

    tracks = data.setdefault("tracks", {})
    art_dir = Path(__file__).resolve().parent / "web" / "art_cache"
    art_dir.mkdir(parents=True, exist_ok=True)

    files = [p for p in root.rglob("*") if p.suffix.lower() in AUDIO_EXTS]
    print(f"Found {len(files)} FLAC files under {root}")

    todo = []
    for p in files:
        rel = str(p.relative_to(root))
        tid = track_id(rel)
        sig = file_signature(p)
        existing = tracks.get(tid)
        # entries analyzed before the art/format-info feature was added won't
        # have this key yet - force them through again even if the file itself
        # hasn't changed, so they pick up cover art and format info too.
        needs_upgrade = existing is not None and "art_ext" not in existing
        if existing and existing.get("sig") == sig and existing.get("ok") and not needs_upgrade:
            continue
        todo.append((tid, rel, str(p), sig))

    print(f"{len(todo)} tracks need analysis ({len(files) - len(todo)} already cached)")
    if not todo:
        recompute_coordinates(tracks)
        out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"Nothing to do. Wrote {out_path}")
        return

    done, errors = run_analysis(todo, args, art_dir, tracks, out_path, data)
    print(f"\nDone. {done - errors} analyzed, {errors} failed. Wrote {out_path}")


if __name__ == "__main__":
    main()
