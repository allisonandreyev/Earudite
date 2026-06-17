"""
Replacement HLS server for macOS (replaces the Linux-only Go-HLS-Streamer binary).

Audio source: Pinafore/audio_data GitHub repo, looked up by matching question text.
"""

import json
import os
import re
import subprocess
import tempfile
import urllib.request
import uuid

import pymongo
import requests
from flask import Flask, abort, jsonify, make_response, request, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app, expose_headers=["x-gostreamer-token"])

HANDSHAKE = os.environ.get("HLS_HANDSHAKE", "I-AM-A-SECRET-KEY")
VTT_BASE_URL = os.environ.get("HLS_VTT_URL", "http://localhost:5110/hls/vtt")
AUDIO_BASE_URL = os.environ.get("HLS_AUDIO_URL", "http://localhost:5110/hls/audio")
PORT = int(os.environ.get("HLS_PORT", 4440))

STREAM_DIR = tempfile.mkdtemp(prefix="earudite_hls_")
print(f"[HLS] Stream cache: {STREAM_DIR}")

streams: dict = {}

# --- Load audio index from GitHub and build question-text lookup ---
COMBINED_JSON_URL = "https://raw.githubusercontent.com/Pinafore/audio_data/main/combined%20(1).json"
AUDIO_INDEX: list = []
# Maps normalised question text → raw GitHub audio URL
QUESTION_TO_AUDIO_URL: dict = {}

def _normalise(text: str) -> str:
    """Lower-case, collapse whitespace, strip trailing punctuation for fuzzy matching."""
    return re.sub(r"\s+", " ", text.lower().strip().rstrip("?. "))

print("[HLS] Downloading audio index from GitHub...")
try:
    with urllib.request.urlopen(COMBINED_JSON_URL, timeout=30) as f:
        AUDIO_INDEX = json.loads(f.read())
    for entry in AUDIO_INDEX:
        url = entry.get("file_name", "").replace(
            "https://raw.githubusercontent.com/tkabir1/audio_data/",
            "https://raw.githubusercontent.com/Pinafore/audio_data/",
        )
        q = _normalise(entry.get("question", ""))
        if url and q and q not in QUESTION_TO_AUDIO_URL:
            QUESTION_TO_AUDIO_URL[q] = url
    print(f"[HLS] Loaded {len(AUDIO_INDEX)} audio entries, {len(QUESTION_TO_AUDIO_URL)} unique questions indexed")
except Exception as e:
    print(f"[HLS] WARNING: Could not load audio index: {e}")

# --- MongoDB (kept for potential future use) ---
MONGO_URI = os.environ.get("CONNECTION_STRING", "")
_audio_col = None
try:
    _mongo = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    _audio_col = _mongo["QuizzrDatabase"]["Audio"]
    _audio_col.find_one({})
    print("[HLS] MongoDB connected")
except Exception as e:
    print(f"[HLS] WARNING: MongoDB unavailable: {e}")


def get_audio_url_for_question(question_text: str) -> str | None:
    """Match the question text against the AUDIO_INDEX and return the audio URL."""
    if not QUESTION_TO_AUDIO_URL or not question_text:
        return None
    norm = _normalise(question_text)
    # 1. Exact match
    if norm in QUESTION_TO_AUDIO_URL:
        return QUESTION_TO_AUDIO_URL[norm]
    # 2. Prefix match on first 8 words
    prefix = " ".join(norm.split()[:8])
    for key, url in QUESTION_TO_AUDIO_URL.items():
        if key.startswith(prefix):
            return url
    # 3. Prefix match on first 5 words
    prefix5 = " ".join(norm.split()[:5])
    for key, url in QUESTION_TO_AUDIO_URL.items():
        if key.startswith(prefix5):
            return url
    return None


# --- VTT helpers ---

def fix_vtt(vtt_text: str) -> str:
    """Normalize VTT so hls.js can parse it."""
    vtt_text = re.sub(r"^WEBVTT[^\n]*", "WEBVTT", vtt_text)

    def pad_ts(m):
        parts = m.group(0).split(":")
        return ":".join(
            p.zfill(2) if "." not in p else p.split(".")[0].zfill(2) + "." + p.split(".")[1]
            for p in parts
        )

    return re.sub(r"\d+(?::\d+)+(?:\.\d+)?", pad_ts, vtt_text)


def _parse_vtt_timestamp(ts: str) -> float:
    parts = ts.split(":")
    try:
        if len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    except Exception:
        return 0.0


def vtt_duration(vtt_text: str) -> float:
    # Use END timestamps (after -->) so we get the true content duration.
    end_stamps = re.findall(r"-->\s*(\d+:\d+[\d.]*)", vtt_text)
    if not end_stamps:
        return 60.0
    return max(_parse_vtt_timestamp(ts) for ts in end_stamps)


def get_audio_duration(audio_path: str) -> float:
    """Return duration of an audio file in seconds via ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
            capture_output=True, text=True, check=True,
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def rescale_vtt(vtt_text: str, orig_duration: float, new_duration: float) -> str:
    """Proportionally rescale every timestamp in a VTT to fit new_duration."""
    if orig_duration <= 0:
        return vtt_text
    scale = new_duration / orig_duration

    def _rescale(m):
        secs = _parse_vtt_timestamp(m.group(0)) * scale
        mins = int(secs // 60)
        return f"{mins:02d}:{secs % 60:06.3f}"

    return re.sub(r"\d+:\d+[\d.]*", _rescale, vtt_text)


# --- HLS build helpers ---

def build_master_m3u8(has_subtitles: bool) -> str:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    if has_subtitles:
        lines += [
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",'
            'NAME="English",DEFAULT=YES,FORCED=NO,URI="subtitle.m3u8",LANGUAGE="en"',
            '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2",SUBTITLES="subs"',
        ]
    else:
        lines.append('#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"')
    lines.append("audio.m3u8")
    return "\n".join(lines) + "\n"


def build_subtitle_m3u8(duration: float) -> str:
    dur = max(int(duration) + 1, 9999)
    return (
        f"#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:{dur}\n"
        f"#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:{duration:.3f},\nsubtitle.vtt\n#EXT-X-ENDLIST\n"
    )


def transcode_to_hls(audio_input: str, output_dir: str) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", audio_input,
            "-codec:a", "aac", "-b:a", "128k",
            "-hls_time", "10", "-hls_list_size", "0",
            "-hls_segment_filename", os.path.join(output_dir, "audio%03d.ts"),
            "-f", "hls", os.path.join(output_dir, "audio.m3u8"),
        ],
        check=True, capture_output=True,
    )


def make_silent_hls(duration: float, output_dir: str) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-t", str(duration),
            "-codec:a", "aac", "-b:a", "32k",
            "-hls_time", "10", "-hls_list_size", "0",
            "-hls_segment_filename", os.path.join(output_dir, "audio%03d.ts"),
            "-f", "hls", os.path.join(output_dir, "audio.m3u8"),
        ],
        check=True, capture_output=True,
    )



def download_and_transcode(qid: str, output_dir: str, qb_id: int | None = None) -> None:
    # 1. VTT (question text cues)
    duration = 60.0
    has_subtitles = False
    try:
        vr = requests.get(f"{VTT_BASE_URL}/{qid}?batch", timeout=10)
        if vr.ok and vr.content:
            fixed = fix_vtt(vr.text)
            duration = vtt_duration(fixed) + 2
            with open(os.path.join(output_dir, "subtitle.vtt"), "w") as f:
                f.write(fixed)
            with open(os.path.join(output_dir, "subtitle.m3u8"), "w") as f:
                f.write(build_subtitle_m3u8(duration))
            has_subtitles = True
            print(f"[HLS] VTT ok for {qid} (~{duration:.1f}s)")
    except Exception as e:
        print(f"[HLS] VTT failed for {qid}: {e}")

    # Extract question text from VTT for audio matching
    question_text = ""
    if has_subtitles:
        cue_texts = re.findall(r"<v [^>]+>(.*?)(?:\n|$)", fixed)
        if not cue_texts:
            cue_texts = re.findall(r"-->[^\n]+\n(.+)", fixed)
        question_text = " ".join(t.strip() for t in cue_texts if t.strip())

    # 2. Audio — try backend first (VTT-aligned recording), then GitHub by question text.
    audio_path = os.path.join(output_dir, "audio_src")
    got_audio = False
    used_github = False

    # Primary: backend audio endpoint
    try:
        backend_audio_url = f"{AUDIO_BASE_URL}/{qid}?batch"
        print(f"[HLS] Downloading audio from backend: {backend_audio_url}")
        r = requests.get(backend_audio_url, timeout=60, stream=True)
        r.raise_for_status()
        audio_path = os.path.join(output_dir, "audio_src.wav")
        with open(audio_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)
        transcode_to_hls(audio_path, output_dir)
        got_audio = True
        print(f"[HLS] Audio transcoded for {qid} (backend source)")
    except Exception as e:
        print(f"[HLS] Backend audio failed for {qid}: {e}")

    # Fallback: match question text → GitHub audio URL
    if not got_audio and question_text:
        audio_url = get_audio_url_for_question(question_text)
        if audio_url:
            try:
                print(f"[HLS] GitHub match for '{question_text[:60]}': {audio_url}")
                r = requests.get(audio_url, timeout=60, stream=True)
                r.raise_for_status()
                ext = audio_url.rsplit(".", 1)[-1].lower()
                audio_path = os.path.join(output_dir, f"audio_src.{ext}")
                with open(audio_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=65536):
                        f.write(chunk)
                transcode_to_hls(audio_path, output_dir)
                got_audio = True
                used_github = True
                print(f"[HLS] Audio transcoded for {qid} (GitHub match)")
            except Exception as e:
                print(f"[HLS] GitHub audio failed for {qid}: {e}")
        else:
            print(f"[HLS] No GitHub match for question: '{question_text[:80]}'")

    # When GitHub audio is used, rewrite VTT to span the full clip.
    # The original VTT timestamps matched a human reading; the clip has different timing.
    if used_github and has_subtitles:
        try:
            audio_dur = get_audio_duration(audio_path)
            if audio_dur > 0:
                end_ts = f"{int(audio_dur // 60):02d}:{audio_dur % 60:06.3f}"
                new_vtt = f"WEBVTT\n\n00:00.500 --> {end_ts}\n<v Speaker 0>{question_text}\n"
                with open(os.path.join(output_dir, "subtitle.vtt"), "w") as f:
                    f.write(new_vtt)
                with open(os.path.join(output_dir, "subtitle.m3u8"), "w") as f:
                    f.write(build_subtitle_m3u8(audio_dur))
                print(f"[HLS] VTT rewritten to span full clip ({audio_dur:.1f}s)")
        except Exception as e:
            print(f"[HLS] VTT rewrite failed for {qid}: {e}")

    if not got_audio:
        print(f"[HLS] Using silent audio for {qid}")
        try:
            make_silent_hls(duration, output_dir)
        except Exception as e:
            print(f"[HLS] Silent audio failed for {qid}: {e}")
            # Last resort: try with full ffmpeg path
            try:
                import subprocess as _sp
                seg = os.path.join(output_dir, "audio%03d.ts")
                m3u8 = os.path.join(output_dir, "audio.m3u8")
                r = _sp.run(
                    ["/opt/homebrew/bin/ffmpeg", "-y",
                     "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
                     "-t", str(int(duration)),
                     "-codec:a", "aac", "-b:a", "32k",
                     "-hls_time", "10", "-hls_list_size", "0",
                     "-hls_segment_filename", seg,
                     "-f", "hls", m3u8],
                    capture_output=True,
                )
                if r.returncode != 0:
                    print(f"[HLS] fallback ffmpeg stderr: {r.stderr[-300:].decode()}")
                else:
                    print(f"[HLS] fallback silent audio ok for {qid}")
            except Exception as e2:
                print(f"[HLS] fallback silent audio also failed for {qid}: {e2}")

    # 3. Master playlist — always write so browser doesn't get 404
    with open(os.path.join(output_dir, "index.m3u8"), "w") as f:
        f.write(build_master_m3u8(has_subtitles))


# --- API endpoints ---

@app.route("/api/batch", methods=["POST"])
def batch():
    if request.form.get("handshake") != HANDSHAKE:
        abort(403)

    qids = request.form.getlist("qids")
    raw_qb_ids = request.form.getlist("qb_ids")
    result_streams = []
    for i, qid in enumerate(qids):
        qb_id = int(raw_qb_ids[i]) if i < len(raw_qb_ids) and raw_qb_ids[i].isdigit() else None
        rid = str(uuid.uuid4())
        stream_dir = os.path.join(STREAM_DIR, rid)
        os.makedirs(stream_dir, exist_ok=True)
        try:
            download_and_transcode(qid, stream_dir, qb_id=qb_id)
        except Exception as e:
            print(f"[HLS] Fatal error for {qid}: {e}")
        streams[rid] = {"qid": qid, "path": stream_dir, "token": None}
        result_streams.append({"qid": qid, "rid": rid})

    return jsonify({"streams": result_streams})


@app.route("/api/unlock", methods=["POST"])
def unlock():
    if request.form.get("handshake") != HANDSHAKE:
        abort(403)
    rid = request.form.get("rid")
    if rid not in streams:
        abort(404)
    token = str(uuid.uuid4())
    streams[rid]["token"] = token
    return jsonify({"token": token})


def _serve(rid: str, filename: str):
    if rid not in streams:
        abort(404)
    path = os.path.join(streams[rid]["path"], filename)
    if not os.path.exists(path):
        abort(404)
    mime = (
        "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else
        "video/MP2T" if filename.endswith(".ts") else
        "text/vtt" if filename.endswith(".vtt") else
        "application/octet-stream"
    )
    resp = make_response(send_file(path, mimetype=mime))
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


@app.route("/hls/<rid>/index.m3u8")
def serve_manifest(rid):
    return _serve(rid, "index.m3u8")


@app.route("/hls/<rid>/<path:filename>")
def serve_file(rid, filename):
    return _serve(rid, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, threaded=True)
