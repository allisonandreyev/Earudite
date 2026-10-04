"""
Import the AUDITA audio-QA dataset into Earudite's question collections.

Default source is the cleansed Hugging Face release (TasnimKabir12/audita-audio); the original
Pinafore/audio_data combined.json is still available with --source pinafore.

Why this exists
---------------
Earudite's question pool used to be protobowl quiz bowl text (long paragraphs, no audio). The
AUDITA dataset is the opposite shape: the *audio clip is the question*, and the text prompt is a
short generic instruction ("Name the composer."). That difference is the whole reason the previous
integration was unreliable.

The old hls_server.py matched a question to its audio by **question text**. That cannot work here:
of 9,690 entries only 3,768 question strings are distinct, and a single string
("You are listening to a theme from a TV Show...") covers 1,320 different clips. Text matching
therefore returned an arbitrary one of those clips — the audio and the question were routinely out
of sync.

This importer fixes the sync at the source: every AUDITA entry becomes exactly one question
document that carries its own `audioUrl`, and exactly one Audio document joined to it by `qb_id`.
Nothing is ever matched by text again. `qb_id` is a deterministic hash of the entry's content, so
re-running this script is idempotent and a given clip keeps its ID across imports.

Usage
-----
    # Inspect what would happen; touches nothing.
    python import_audita.py --dry-run

    # Back up the existing collections, then replace the question pool.
    CONNECTION_STRING=... python import_audita.py --replace

    # Spot-check that the audio URLs actually resolve on GitHub.
    python import_audita.py --dry-run --verify-audio 50

Only the question collections are replaced. The `Audio` collection's existing user-contributed
recordings are left untouched — this script only *adds* its own AUDITA rows there (they are tagged
`source: "audita"`). Old recordings become inert rather than deleted, because their `qb_id`s no
longer match any question.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import pymongo

COMBINED_JSON_URL = "https://raw.githubusercontent.com/Pinafore/audio_data/main/combined%20(1).json"

# The cleansed release on Hugging Face (the default source since 2026-10-03). Same 9,690 questions,
# but 4,184 of the 6,460 human-authored answers were cleaned of packet markup and file-name noise —
# "Terry Wogan_01" -> "Terry Wogan", "_Swan Lake_ [or ...]" -> "Swan Lake [or ...]",
# "Simply Red - Stars (Clip)" -> "Simply Red - Stars" — which is exactly the noise that made
# fuzzy answer matching reject correct spoken answers. The raw answer is kept as
# `original_ground_truth`. Its schema differs from combined.json; adapt_hf_entry() maps it across.
HF_REPO = "TasnimKabir12/audita-audio"
HF_JSON_URL = f"https://huggingface.co/datasets/{HF_REPO}/resolve/main/all_combined_9690_unsplit_full_audio_data.json"
HF_AUDIO_BASE = f"https://huggingface.co/datasets/{HF_REPO}/resolve/main/"

# The human-authored rows still carry the authors' cluster paths. Each cluster directory was
# uploaded to the repo under a new name with the same layout beneath it. Matching on basename
# alone is not enough: 1,362 rows share names like "01.mp3" across packet folders.
HF_PATH_PREFIXES = {
    "/fs/nexus-scratch/dmku66/quizmasters/": "Our sources/Trivia(quizmasters)/",
    "/fs/nexus-scratch/dmku66/audio-packets/": "Our sources/Quizbowl/audio-packets/",
    "/fs/nexus-scratch/dmku66/unsplit_Pavements_I_II_III/": "Our sources/Quizbowl/Pavements/",
}
# External rows (OpenAQA, ClothoAQA) are all flat in this folder, with unique basenames.
HF_EXTERNAL_DIR = "External Sources/"

# HF main_category -> the raw category strings question_categories.py buckets on. Measured against
# the previous import: each HF category lines up with exactly one raw one.
HF_CATEGORY_MAP = {
    "Music Identification": "name",
    "Media Content": "pop",
    "Character/Person": "person",
    "Musical Elements": "element",
    "Musical Performance": "element",
    "Cultural/Geographic": "geo",
    "Sound Identification": "sound",
    "Other": "sound",
}

# combined.json's `file_name` values still point at the dataset's original home. The files live in
# the Pinafore fork now; the paths below it are identical.
STALE_REPO_PREFIX = "https://raw.githubusercontent.com/tkabir1/audio_data/"
LIVE_REPO_PREFIX = "https://raw.githubusercontent.com/Pinafore/audio_data/"

DB_NAME = os.environ.get("DATABASE", "QuizzrDatabase")

# AUDITA's six raw categories. These strings are what lands in each document's `category` field and
# what quizzr-server/question_categories.py maps onto user-facing buckets — keep the two in sync.
AUDITA_CATEGORIES = ("sound", "name", "pop", "element", "person", "geo")

# Some source paths encode a difficulty ("01_Medium.mp3", "02_Hard.mp3"); most do not.
DIFFICULTY_RE = re.compile(r"(?i)[_/](easy|medium|hard)\b")
DIFFICULTY_LABELS = {"easy": "Easy", "medium": "Medium", "hard": "Hard"}
# recDifficulty drives the record-flow's percentile banding, so only the relative order matters.
# difficultyNum is the integer band the /question endpoint filters on.
DIFFICULTY_SCORES = {"Easy": 5.0, "Medium": 13.0, "Hard": 20.0}
DIFFICULTY_NUMS = {"Easy": 0, "Medium": 1, "Hard": 2}
DEFAULT_DIFFICULTY = "Medium"

# Placeholder only. The real clip length is not known without downloading all 9,690 files, so the
# HLS server measures it with ffprobe at stream time and rewrites the VTT to span the actual audio.
PLACEHOLDER_DURATION = 30


def normalise_text(value: str) -> str:
    """
    Turn the dataset's escaped line breaks into real ones.

    687 of the sound-captioning prompts carry the two characters backslash-n rather than a newline
    ("Answer format: ... \\n\\n Example: ..."). Left alone they are displayed literally, so the
    question reads as one run-on line with visible \\n markers where the formatting should be.
    """
    if not value:
        return ""
    text = value.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", " ")
    # Tidy the result: no trailing spaces per line, and never more than one blank line.
    lines = [ln.strip() for ln in text.split("\n")]
    out, blanks = [], 0
    for ln in lines:
        if ln:
            blanks = 0
            out.append(ln)
        else:
            blanks += 1
            if blanks == 1 and out:
                out.append("")
    while out and not out[-1]:
        out.pop()
    return "\n".join(out)


def vtt_cue_text(value: str) -> str:
    """
    Same text, safe to embed in a WebVTT cue.

    A cue may span several lines but a BLANK line terminates it, so blank lines are dropped rather
    than preserved — otherwise the second half of a prompt would silently fall outside the cue.
    """
    return "\n".join(ln for ln in normalise_text(value).split("\n") if ln)


def normalise_audio_url(raw_url: str) -> str:
    """
    Point a `file_name` at the live repo and percent-encode its path.

    Roughly 1 in 8 source paths contains a literal space ("geo/Jr High Hallway Front.wav"), which
    raw.githubusercontent.com rejects outright. Only the path is encoded, and `%` is left unsafe so
    an already-encoded path is not double-encoded.
    """
    url = raw_url.strip()
    if url.startswith(STALE_REPO_PREFIX):
        url = LIVE_REPO_PREFIX + url[len(STALE_REPO_PREFIX):]

    parts = urllib.parse.urlsplit(url)
    # safe="/%" keeps separators and pre-encoded triplets intact; spaces etc. get encoded.
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, urllib.parse.quote(parts.path, safe="/%"), parts.query, parts.fragment)
    )


def hf_audio_path(entry: dict) -> str:
    """Repo-relative path of an HF entry's clip."""
    raw = (entry.get("file_name") or "").strip()
    if "dataset" in entry:  # external benchmark row
        return HF_EXTERNAL_DIR + raw.rsplit("/", 1)[-1]
    for cluster_prefix, repo_prefix in HF_PATH_PREFIXES.items():
        if raw.startswith(cluster_prefix):
            return repo_prefix + raw[len(cluster_prefix):]
    raise ValueError(f"no repo folder known for {raw!r}")


def adapt_hf_entry(entry: dict) -> dict:
    """
    Reshape a Hugging Face row into the combined.json shape the rest of this script reads.

    The two halves of the HF file have different schemas: human-authored rows carry
    main_category/subcategory/original_ground_truth, external rows carry
    dataset/task/Categories. External rows were all "sound" in the previous import (their
    `Categories` label is spread evenly over all six and does not describe the clip), so they stay
    "sound".
    """
    external = "dataset" in entry
    category = "sound" if external else HF_CATEGORY_MAP.get(entry.get("main_category"), "sound")
    return {
        "file_name": HF_AUDIO_BASE + urllib.parse.quote(hf_audio_path(entry)),
        "question": entry.get("question") or "",
        "answer": entry.get("ground_truth") or "",
        "category": category,
        "original_answer": entry.get("original_ground_truth") or "",
        "source_subcategory": (entry.get("task") if external else entry.get("subcategory")) or "",
        "source_dataset": entry.get("dataset") or "audita",
        "source_path": (entry.get("file_name") or "").strip(),
    }


def stable_qb_id(entry: dict) -> int:
    """
    Derive a deterministic 48-bit question ID from the entry's full content.

    Hashing the whole entry (not just the audio path) matters: 969 clips are reused by more than one
    question, and those must stay separate questions. Re-running the import reproduces the same IDs,
    so recordings and leaderboard rows keyed on qb_id survive a reimport.
    """
    payload = "\x00".join(
        str(entry.get(field, ""))
        for field in ("file_name", "question", "answer", "category", "option1", "option2", "option3", "option4")
    )
    return int(hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12], 16)


def audio_doc_id(qb_id: int) -> str:
    """Audio._id doubles as the HLS stream key and appears in a URL path, so keep it URL-safe."""
    return f"audita-{qb_id:012x}"


def difficulty_for(audio_url: str) -> str:
    match = DIFFICULTY_RE.search(audio_url)
    return DIFFICULTY_LABELS[match.group(1).lower()] if match else DEFAULT_DIFFICULTY


def build_vtt(question_text: str) -> str:
    """
    A single cue holding the prompt.

    merge_vtts() in vtt_conversion.py slices off the first two lines as the header, so the blank
    line after WEBVTT is required, not cosmetic.
    """
    safe = vtt_cue_text(question_text)
    end = f"{PLACEHOLDER_DURATION // 60:02d}:{PLACEHOLDER_DURATION % 60:06.3f}"
    return f"WEBVTT\n\n00:00.500 --> {end}\n<v Speaker 0>{safe}\n"


def load_entries(path: str = None, source: str = "hf") -> list:
    if path:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    else:
        url = HF_JSON_URL if source == "hf" else COMBINED_JSON_URL
        print(f"Downloading {url} ...")
        with urllib.request.urlopen(url, timeout=120) as f:
            raw = json.loads(f.read())
    # Detect the shape rather than trusting the flag, so --json works with either file.
    if raw and "ground_truth" in raw[0]:
        return [adapt_hf_entry(e) for e in raw]
    return raw


def build_documents(entries: list):
    """
    Turn raw AUDITA entries into (question_docs, audio_docs).

    The two lists are generated together and joined on qb_id, which is what guarantees a clip can
    never drift onto the wrong question.
    """
    questions, audios = [], []
    seen_ids = set()
    duplicates = 0
    skipped = 0
    now = datetime.now(timezone.utc)

    for entry in entries:
        raw_url = (entry.get("file_name") or "").strip()
        question_text = normalise_text(entry.get("question") or "")
        answer = normalise_text(entry.get("answer") or "")
        if not raw_url or not question_text or not answer:
            skipped += 1
            continue

        qb_id = stable_qb_id(entry)
        if qb_id in seen_ids:
            # combined.json ships a handful of byte-identical rows; collapse them.
            duplicates += 1
            continue
        seen_ids.add(qb_id)

        audio_url = normalise_audio_url(raw_url)
        category = entry.get("category") or "sound"
        difficulty = difficulty_for(audio_url)
        options = [
            normalise_text(entry.get(key) or "")
            for key in ("option1", "option2", "option3", "option4")
        ]
        aid = audio_doc_id(qb_id)

        questions.append({
            "qb_id": qb_id,
            "transcript": question_text,
            "answer": answer,
            # Stored so the multiple-choice variants are available to the client later. Answer
            # checking still runs on `answer` via fuzzy matching — unchanged by this import.
            "options": [o for o in options if o],
            # THE sync link: the clip this question is about, resolved with no text matching.
            "audioUrl": audio_url,
            "category": category,
            "subcategory": "Audio",
            "difficulty": difficulty,
            "difficultyNum": DIFFICULTY_NUMS[difficulty],
            "recDifficulty": DIFFICULTY_SCORES[difficulty],
            "dataset": "audita",
            "source": "audita",
            "sourceUrl": entry.get("source_path") or raw_url,
            # HF-only provenance: the pre-cleansing answer, the authors' finer label, and which
            # benchmark an external row came from. Empty for the old combined.json source.
            "originalAnswer": normalise_text(entry.get("original_answer") or ""),
            "sourceSubcategory": entry.get("source_subcategory") or "",
            "sourceDataset": entry.get("source_dataset") or "audita",
            "tokenizations": [[0, len(question_text)]],
            "recordings": [{"id": aid, "recType": "normal"}],
            "importedAt": now,
        })

        audios.append({
            "_id": aid,
            "qb_id": qb_id,
            # 2.x = the cleansed Hugging Face release, 1.x = the original combined.json.
            "version": "audita-2.0.0" if "source_path" in entry else "audita-1.0.0",
            "recType": "normal",
            "source": "audita",
            "audioUrl": audio_url,
            "vtt": build_vtt(question_text),
            "duration": PLACEHOLDER_DURATION,
            "sentenceId": 0,
            "tokenizationId": 0,
            # /hls/vtt/<id>?batch groups by this. One clip per question means the "batch" is a
            # single VTT, which merge_vtts handles as a pass-through.
            "batchUUID": aid,
            "score": {},
            "recordingScore": 1,
            "importedAt": now,
        })

    return questions, audios, duplicates, skipped


def verify_audio(questions: list, sample_size: int) -> None:
    """HEAD a random sample of audio URLs so a broken import is caught before it goes live."""
    import random

    random.seed(20260821)
    sample = random.sample(questions, min(sample_size, len(questions)))
    ok = 0
    print(f"\nVerifying {len(sample)} audio URLs ...")
    for doc in sample:
        req = urllib.request.Request(doc["audioUrl"], method="HEAD")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 200:
                    ok += 1
                else:
                    print(f"  [{resp.status}] {doc['audioUrl']}")
        except Exception as exc:
            print(f"  [ERR] {doc['audioUrl']} -> {exc}")
    print(f"Audio reachable: {ok}/{len(sample)}")
    if ok < len(sample):
        print("WARNING: some clips did not resolve; re-run with a larger sample before replacing.")


def backup_collections(db, out_dir: str) -> None:
    import bson.json_util

    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for name in ("UnrecordedQuestions", "RecordedQuestions", "Audio"):
        docs = list(db.get_collection(name).find())
        path = os.path.join(out_dir, f"{name}.{stamp}.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(bson.json_util.dumps(docs))
        print(f"  backed up {len(docs):>5} docs -> {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", help="Path to a local dataset JSON, either shape (defaults to downloading)")
    parser.add_argument("--source", choices=("hf", "pinafore"), default="hf",
                        help="Which release to download: the cleansed Hugging Face one (default) or "
                             "the original Pinafore/audio_data combined.json")
    parser.add_argument("--dry-run", action="store_true", help="Build and summarise documents without writing")
    parser.add_argument("--replace", action="store_true", help="Wipe the question collections and load AUDITA")
    parser.add_argument("--verify-audio", type=int, metavar="N", default=0,
                        help="HEAD N random audio URLs to confirm they resolve")
    parser.add_argument("--backup-dir", default="question_backups", help="Where to write pre-wipe backups")
    parser.add_argument("--no-backup", action="store_true", help="Skip the backup (not recommended)")
    args = parser.parse_args()

    if not args.dry_run and not args.replace:
        parser.error("pass --dry-run to preview, or --replace to actually load")

    entries = load_entries(args.json, args.source)
    print(f"Loaded {len(entries)} raw AUDITA entries")

    questions, audios, duplicates, skipped = build_documents(entries)
    print(f"Built {len(questions)} questions / {len(audios)} audio docs "
          f"({duplicates} exact duplicates collapsed, {skipped} incomplete rows skipped)")

    by_cat = {}
    for doc in questions:
        by_cat[doc["category"]] = by_cat.get(doc["category"], 0) + 1
    print("\nCategory breakdown:")
    for cat, count in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>5}  {cat}")

    unique_clips = len({doc["audioUrl"] for doc in questions})
    print(f"\nDistinct clips: {unique_clips} "
          f"({len(questions) - unique_clips} questions reuse a clip a second question also asks about)")
    print(f"Distinct qb_ids: {len({d['qb_id'] for d in questions})} (must equal question count)")

    if args.verify_audio:
        verify_audio(questions, args.verify_audio)

    if args.dry_run:
        print("\nDry run — nothing written.")
        print("Sample question document:")
        print(json.dumps(questions[0], indent=2, default=str))
        return 0

    connection_string = os.environ.get("CONNECTION_STRING")
    if not connection_string:
        print("ERROR: CONNECTION_STRING is not set", file=sys.stderr)
        return 1

    client = pymongo.MongoClient(connection_string, serverSelectionTimeoutMS=20000)
    db = client.get_database(DB_NAME)

    if not args.no_backup:
        print(f"\nBacking up existing collections to {args.backup_dir}/ ...")
        backup_collections(db, args.backup_dir)

    unrec = db.get_collection("UnrecordedQuestions")
    rec = db.get_collection("RecordedQuestions")
    audio = db.get_collection("Audio")

    print("\nReplacing question pool ...")
    print(f"  UnrecordedQuestions: deleted {unrec.delete_many({}).deleted_count}")
    print(f"  RecordedQuestions:   deleted {rec.delete_many({}).deleted_count}")
    # Only this script's own rows are cleared here, so a rerun stays idempotent without ever
    # touching the user-contributed recordings that share this collection.
    print(f"  Audio (audita rows): deleted {audio.delete_many({'source': 'audita'}).deleted_count}")

    # Everything goes into RecordedQuestions: each question already "has" its recording (the AUDITA
    # clip), which is the collection the Play flow samples from.
    rec.insert_many(questions, ordered=False)
    audio.insert_many(audios, ordered=False)
    print(f"  RecordedQuestions:   inserted {len(questions)}")
    print(f"  Audio:               inserted {len(audios)}")

    rec.create_index("qb_id")
    rec.create_index([("category", pymongo.ASCENDING), ("recDifficulty", pymongo.ASCENDING)])
    audio.create_index("qb_id")
    print("  indexes ensured on qb_id / category")

    remaining_user_audio = audio.count_documents({"source": {"$ne": "audita"}})
    print(f"\nDone. {remaining_user_audio} pre-existing user recordings left untouched in Audio.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
