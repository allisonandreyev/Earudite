"""Loads the Piper voice used for the "Read by Computer" question mode.

Shared by hls_server.py and setup_tts.sh so the startup check tests exactly what the server runs.

Two things here exist because a plain ``PiperVoice.load(path)`` fails on some machines:

* The voice model (63 MB, gitignored) is downloaded on first use if it is missing, so a fresh
  checkout works without a manual step (as long as huggingface.co is reachable).
* eSpeak NG, which Piper uses for pronunciation, cannot open its data folder when that path is
  longer than about 160 characters: it silently falls back to a path from the machine Piper was
  built on and every reading fails. A deeply nested install (a long home directory, a virtualenv
  inside a project inside a share) hits that. When the path is long, Piper is pointed at a short
  symlink in the temp directory instead.
"""

import hashlib
import os
import tempfile
from pathlib import Path

DEFAULT_VOICE = "en_US-lessac-medium"
VOICES_DIR = Path(__file__).resolve().parent / "voices"
# eSpeak NG's limit is 160 bytes including the file names it appends; stay well under it.
_MAX_ESPEAK_PATH = 100


def model_path() -> Path:
    """The .onnx model to use: $PIPER_VOICE if set, else hls/voices/<DEFAULT_VOICE>.onnx."""
    override = os.environ.get("PIPER_VOICE")
    if override:
        return Path(override)
    return VOICES_DIR / f"{os.environ.get('PIPER_VOICE_NAME', DEFAULT_VOICE)}.onnx"


def ensure_model(path: Path) -> None:
    """Download the voice next to `path` if it (or its .json config) is missing."""
    if path.is_file() and path.with_suffix(".onnx.json").is_file():
        return
    from piper.download_voices import download_voice
    path.parent.mkdir(parents=True, exist_ok=True)
    download_voice(path.stem, path.parent)
    if not path.is_file():
        raise FileNotFoundError(f"voice download did not produce {path}")


def _espeak_data_dir() -> str:
    """Piper's bundled eSpeak data folder, via a short symlink if its real path is too long."""
    from piper.phonemize_espeak import ESPEAK_DATA_DIR
    real = str(ESPEAK_DATA_DIR)
    if len(real) <= _MAX_ESPEAK_PATH:
        return real
    # Named after the real path, so two installs on one machine never repoint each other's link.
    tag = hashlib.sha1(real.encode()).hexdigest()[:10]
    link = os.path.join(tempfile.gettempdir(), f"earudite-espeak-{tag}")
    if len(link) > _MAX_ESPEAK_PATH:  # an unusually long temp dir too; try the filesystem root
        link = f"/tmp/earudite-espeak-{tag}"
    try:
        if os.path.realpath(link) != os.path.realpath(real):
            if os.path.lexists(link):
                os.remove(link)
            os.symlink(real, link)
        return link
    except OSError:
        return real  # no symlink possible; try the long path and let the caller report a failure


def load_voice():
    """Return a loaded PiperVoice. Raises with a readable reason if it can't."""
    from piper import PiperVoice
    path = model_path()
    ensure_model(path)
    return PiperVoice.load(str(path), espeak_data_dir=_espeak_data_dir())
