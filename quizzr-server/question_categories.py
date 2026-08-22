"""
Maps the AUDITA dataset's own `category` field (present on every question document written by
maintenance/import_audita.py) onto a fixed set of user-facing buckets, and its `difficulty` field
onto a two-tier easy/hard label.

Nothing here is written back to the database — these are pure functions computed at request
time, so editing the taxonomy below is the entire "add/edit a category" workflow. No migration,
no backfill, no risk of a stored field drifting out of sync with these rules.

Scope: UnrecordedQuestions and RecordedQuestions share the same document shape (a question
moves from one collection to the other, unchanged, once it gets its first recording — see
tpm.py), so these functions work against either. server.py's pick_recording_question decides
per request which collection(s) to query.
"""

from typing import Dict, List, Optional, Tuple

# Each bucket maps to a list of (category, subcategory) rules. subcategory of None means
# "match this category regardless of subcategory" — i.e. a whole-category rename.
# To add/edit a bucket: just add/edit an entry here. To split a bucket later (e.g. carve
# "Sports" out of "Sports/Pop Culture"), add a new bucket and narrow this one's rule(s).
CATEGORY_BUCKETS: Dict[str, List[Tuple[str, Optional[str]]]] = {
    # AUDITA's six raw category values, written by maintenance/import_audita.py. The rule keys are
    # the lowercase strings stored in each document's `category` field; the bucket names are what
    # the client shows and passes back as the `category` query param.
    "Music ID": [("name", None)],
    "Musical Elements": [("element", None)],
    "Sports/Pop Culture": [("pop", None)],
    "Character/Person": [("person", None)],
    "Geography": [("geo", None)],
    "Sound/Environment": [("sound", None)],
    # No explicit rule set for Miscellaneous — it's the fallback in bucket_for() /
    # category_to_mongo_filter() for anything not matched above.
}

MISC_BUCKET = "Miscellaneous"
ALL_BUCKETS = list(CATEGORY_BUCKETS.keys()) + [MISC_BUCKET]

# AUDITA has no difficulty field of its own; the importer derives Easy/Medium/Hard from the clip
# path where it encodes one ("01_Medium.mp3") and defaults to Medium otherwise.
DIFFICULTY_TIERS: Dict[str, str] = {
    "Easy": "easy",
    "Medium": "easy",
    "Hard": "hard",
}


def bucket_for(doc: dict) -> str:
    """Return the user-facing category bucket for a question document."""
    category = doc.get("category")
    subcategory = doc.get("subcategory")
    for bucket, rules in CATEGORY_BUCKETS.items():
        for rule_category, rule_subcategory in rules:
            if category == rule_category and (rule_subcategory is None or subcategory == rule_subcategory):
                return bucket
    return MISC_BUCKET


def difficulty_tier_for(doc: dict) -> Optional[str]:
    """Return "easy"/"hard" for a question document, or None if its difficulty is unknown."""
    return DIFFICULTY_TIERS.get(doc.get("difficulty"))


def category_to_mongo_filter(bucket: str) -> dict:
    """
    Build the MongoDB filter fragment matching every document that belongs to the given bucket.

    :param bucket: One of ALL_BUCKETS.
    :raises ValueError: If bucket is not a recognized bucket name.
    """
    if bucket not in ALL_BUCKETS:
        raise ValueError(f"Unknown category bucket: {bucket!r}")

    if bucket == MISC_BUCKET:
        # Everything that doesn't match any other bucket's rules.
        matched_conditions = [
            {"category": rule_category} if rule_subcategory is None
            else {"category": rule_category, "subcategory": rule_subcategory}
            for rules in CATEGORY_BUCKETS.values()
            for rule_category, rule_subcategory in rules
        ]
        return {"$nor": matched_conditions}

    conditions = [
        {"category": rule_category} if rule_subcategory is None
        else {"category": rule_category, "subcategory": rule_subcategory}
        for rule_category, rule_subcategory in CATEGORY_BUCKETS[bucket]
    ]
    return conditions[0] if len(conditions) == 1 else {"$or": conditions}
