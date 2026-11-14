#!/usr/bin/env bash
# Makes sure the computer voice (Piper) used by the "Read by Computer" question mode works on this
# machine: installs piper-tts, downloads the voice model, and speaks one test sentence.
#
# Safe to run any number of times; it skips whatever is already in place. start_all.sh runs it
# before starting the HLS server. Run it by hand on a new server, or point it at a specific Python:
#
#   hls/setup_tts.sh                       # uses the python on PATH
#   hls/setup_tts.sh /path/to/env/bin/python
#
# Exit status: 0 = the voice works; 1 = it does not (the message says why). The game still runs
# when it fails: read-aloud questions fall back to showing their text.
set -uo pipefail

HLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${1:-${PYTHON:-python3}}"

fail() { echo "TTS SETUP FAILED: $*" >&2; exit 1; }
say_ok() { echo "TTS: $*"; }

command -v "$PY" >/dev/null 2>&1 || [ -x "$PY" ] || fail "python not found: $PY"

# 1. Python version. piper-tts needs 3.9+.
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || fail "Python 3.9+ required, found $("$PY" --version 2>&1)"

# 2. piper-tts. Its speech runtime (onnxruntime) only ships prebuilt Linux packages for glibc 2.28+
#    (Ubuntu 20.04+, RHEL/Rocky 8+), so say so plainly if the install fails on an older system.
if ! "$PY" -c 'import piper' >/dev/null 2>&1; then
  say_ok "installing piper-tts..."
  if ! "$PY" -m pip install --quiet "piper-tts>=1.8"; then
    glibc="$(ldd --version 2>/dev/null | head -1)"
    fail "could not install piper-tts with $PY. System: $(uname -sm). ${glibc:+glibc: $glibc. }Prebuilt packages need Linux with glibc 2.28+ (x86_64 or aarch64), macOS or Windows."
  fi
fi
say_ok "piper-tts $("$PY" -c 'from importlib.metadata import version; print(version("piper-tts"))') installed"

# 3 + 4. Load the voice exactly as hls_server.py does (piper_voice.load_voice downloads the model
#        if missing and works around eSpeak's path-length limit), then speak a test sentence.
#        The download needs huggingface.co once; if that is blocked, copy hls/voices/ over by hand.
say_ok "loading voice ${PIPER_VOICE_NAME:-en_US-lessac-medium} (downloads 63 MB the first time)..."
if ! "$PY" - "$HLS_DIR" <<'EOF'
import sys, tempfile, wave, os
sys.path.insert(0, sys.argv[1])
import piper_voice
try:
    voice = piper_voice.load_voice()
except Exception as e:
    sys.exit(f"could not load the voice: {e}")
with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
    out = f.name
with wave.open(out, "wb") as wf:
    voice.synthesize_wav("Name the work.", wf)
size = os.path.getsize(out)
os.remove(out)
if size < 1000:
    sys.exit("Piper produced an empty test file")
print(f"TTS: voice model: {piper_voice.model_path()}")
EOF
then
  fail "the computer voice does not work (see the message above). If the download failed, copy en_US-lessac-medium.onnx and .onnx.json into $HLS_DIR/voices/."
fi
say_ok "test sentence spoken OK — the computer voice is ready"
