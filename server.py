"""
Music Square local server.

Serves the web player and streams your FLAC files so the browser can play
them. Nothing leaves your machine.

Usage:
    python server.py                     # uses library.json in this folder
    python server.py --library my.json
    python server.py --port 8765
"""

import argparse
import json
from pathlib import Path

from flask import Flask, jsonify, send_file, send_from_directory, abort, request
from flask_cors import CORS

app = Flask(__name__, static_folder=None)
CORS(app)

STATE = {"library_path": None, "root": None, "tracks": {}}


def load_library():
    p = Path(STATE["library_path"])
    if not p.exists():
        STATE["root"] = None
        STATE["tracks"] = {}
        return

    data = json.loads(p.read_text(encoding="utf-8"))
    STATE["root"] = Path(data["root"])
    STATE["tracks"] = {
        tid: t for tid, t in data["tracks"].items()
        if t.get("ok")
    }


@app.route("/")
def index():
    return send_from_directory(Path(__file__).parent / "web", "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    web_dir = Path(__file__).parent / "web"

    if (web_dir / filename).is_file():
        return send_from_directory(web_dir, filename)

    abort(404)


@app.route("/api/library")
def api_library():
    load_library()

    tracks = []

    for tid, t in STATE["tracks"].items():
        art_ext = t.get("art_ext")

        tracks.append({
            "id": tid,
            "title": t.get("title") or t.get("rel_path"),
            "artist": t.get("artist", "Unknown Artist"),
            "album": t.get("album", "Unknown Album"),
            "duration": t.get("duration", 0),
            "tempo": round(t.get("tempo", 0)),
            "x": t.get("x", 0),
            "y": t.get("y", 0),
            "art": f"/art_cache/{tid}.{art_ext}" if art_ext else None,
            "samplerate": t.get("samplerate", 44100),
            "bit_depth": t.get("bit_depth", 16),
            "bitrate_kbps": t.get("bitrate_kbps", 0),
        })

    return jsonify({
        "count": len(tracks),
        "tracks": tracks
    })


@app.route("/api/audio/<track_id>")
def api_audio(track_id):
    load_library()

    t = STATE["tracks"].get(track_id)

    if not t:
        abort(404)

    full_path = STATE["root"] / t["rel_path"]

    if not full_path.is_file():
        abort(404)

    return send_file(
        full_path,
        mimetype="audio/flac",
        conditional=True
    )


def main():
    ap = argparse.ArgumentParser()

    ap.add_argument(
        "--library",
        default="library.json"
    )

    ap.add_argument(
        "--port",
        type=int,
        default=8765
    )

    args = ap.parse_args()

    STATE["library_path"] = args.library

    load_library()

    n = len(STATE["tracks"])

    if n == 0:
        print(f"[!] No analyzed tracks found in {args.library}.")
        print("    Run analyze_library.py first, e.g.:")
        print('    python analyze_library.py "D:/Music"')
    else:
        print(f"Loaded {n} tracks from {args.library}")

    print("\nServer is available at:")
    print(f"  Local PC:    http://127.0.0.1:{args.port}")

    import socket

    try:
        local_ip = socket.gethostbyname(socket.gethostname())
        print(f"  Network:     http://{local_ip}:{args.port}")
    except Exception:
        pass

    print("\nOpen the Network address on your phone if it's on the same Wi-Fi/LAN.\n")

    app.run(
        host="0.0.0.0",
        port=args.port,
        debug=False,
        threaded=True
    )


if __name__ == "__main__":
    main()