"""Semantic answer judging with a BERT answer-equivalence classifier.

String similarity can't tell a *sufficient* partial answer ("Mozart" for "Wolfgang Amadeus
Mozart") from an *insufficient* one ("Beethoven" for "Symphony No. 6 by Beethoven"), and it
can't see that "USA" means "United States of America". This model reads the guess, the gold
answer and the question together and returns the probability that the guess is correct.

On its own the model is too lenient for quiz bowl: it accepted the composer for "Name the
piece", the artist alone for "What is this song and who made it?", wrong numbers, and first
names. So ``judge()`` first works out what the question asks for (``required_parts``) and
checks the guess names each part, and only then asks the model whether the guess is
equivalent to it. Measured on guesses built from the AUDITA question bank:

                                       general (3,394 held out)    question-structure (1,122)
    rule                               right rej.   wrong acc.     right rej.   wrong acc.
    old fuzzy + Soundex                4.2%         21.2%          -            -
    model alone, score >= 0.5          2.0%         26.2%          -            -
    first judge() (no question parts)  2.0%          6.4%          ~47% of verdicts wrong
    judge(), min_score 0.5             2.5%          6.7%          3.9%         2.0%

Model: zli12321/answer_equivalence_bert (from the qa_metrics project,
https://github.com/zli12321/qa_metrics). The input format below copies qa_metrics'
TransformerMatcher.get_score exactly, because that is what the model was trained on.

The model is ~440 MB and downloads from Hugging Face on first use, so ``start_loading()``
loads it on a background thread. Until it is ready (or if it fails), ``judge()`` returns
None and the caller falls back to string matching.
"""
import logging
import re
import threading
from typing import List, Optional

from fuzzywuzzy import fuzz

import soundex

MODEL_NAME = "zli12321/answer_equivalence_bert"

# Quiz bowl answers list alternates: "Pastoral Symphony or Symphony No. 6 [or Beethoven 6]".
# The model judges a guess against the whole string, so naming only one alternate scored ~0.44
# and was rejected. Each alternate is scored on its own instead. " - " is NOT an alternate
# separator: "ABC - The Look of Love" is two parts of one answer (see required_parts).
_ALTERNATE_SPLIT_RE = re.compile(r"\s+(?:or|aka|a\.k\.a\.)\s+|[;/]|\[|\]|\(|\)", re.IGNORECASE)

# What the question asks for, from the bank's question templates.
# "What is this song and the name of the person who made it?", "Name BOTH the genre and the composer."
_TWO_PART_Q_RE = re.compile(r"\band (?:the name of )?(?:the )?(?:person|who|composer|artist)|\bboth\b|\band who\b", re.IGNORECASE)
# Questions asking for a person or group: "Name the composer.", "What is the name of the person who
# is speaking?", "Name this philosopher." A surname alone names them ("Mozart"). Checked after
# _TWO_PART_Q_RE, so "the song and the person who made it" still needs both.
_CREATOR_Q_RE = re.compile(
    r"\b(?:composer|artist|group|band|bandleader|producer|performer|singer|vocalist|rapper|conductor|"
    r"pianist|violinist|director|actor|actress|male lead|female lead|author|writer|poet|philosopher|"
    r"president|scientist|painter|king|queen|emperor|leader|person|character|comedian|impersonating|who)\b",
    re.IGNORECASE,
)
# "What TV show is this clip from?" -> "Seinfeld - Big Move": the show is the answer, the episode is detail.
_SCREEN_Q_RE = re.compile(r"\b(?:tv show|movie)\b", re.IGNORECASE)

# A title needs at least this fraction of its words: "Charlie's Angels" isn't named by
# "charlie" (the model gave it 0.93), "Hitchhiker's Guide to the Galaxy" isn't named by
# "hitchhiker". Number words count as digits, so "symphony number six" covers "Symphony No. 6".
MIN_TITLE_COVERAGE = 2 / 3
_NUMBER_WORDS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve".split())}
_NUMBER_WORDS.update({w: str(i) for i, w in enumerate(
    "zeroth first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth".split())})
_NUMBER_WORDS.update({"number": "no", "num": "no", "nr": "no", "op": "opus"})
_ORDINAL_RE = re.compile(r"^(\d+)(?:st|nd|rd|th)$")

# A guess word this close to an answer word is treated as a misspelling of it.
_SNAP_MIN_RATIO = 80
_SNAP_PHONETIC_MIN_RATIO = 60

_logger = logging.getLogger(__name__)
_lock = threading.Lock()
_model = None
_tokenizer = None
_torch = None
_state = "idle"  # idle -> loading -> ready | failed


def start_loading(logger: logging.Logger = None, model_name: str = None):
    """Load the model on a background thread. Safe to call more than once.

    ``model_name`` swaps in another qa_metrics answer-equivalence checkpoint, e.g.
    "zli12321/roberta-large-qa-evaluator"."""
    global _state, _logger, MODEL_NAME
    if logger is not None:
        _logger = logger
    if model_name:
        MODEL_NAME = model_name
    with _lock:
        if _state != "idle":
            return
        _state = "loading"
    threading.Thread(target=_load, name="bert-matcher-load", daemon=True).start()


def _load():
    global _model, _tokenizer, _torch, _state
    try:
        _logger.info(f"Loading answer matcher model '{MODEL_NAME}'...")
        import torch
        if "roberta" in MODEL_NAME.lower():
            from transformers import RobertaForSequenceClassification as model_cls, RobertaTokenizer as tokenizer_cls
        else:
            from transformers import BertForSequenceClassification as model_cls, BertTokenizer as tokenizer_cls
        tokenizer = tokenizer_cls.from_pretrained(MODEL_NAME)
        model = model_cls.from_pretrained(MODEL_NAME).eval()
        _torch, _tokenizer, _model = torch, tokenizer, model
        _state = "ready"
        _logger.info("Answer matcher model ready")
    except Exception:
        _state = "failed"
        _logger.exception("Could not load answer matcher model; falling back to string matching")


def is_ready() -> bool:
    return _state == "ready"


def alternates(answer: str) -> List[str]:
    """The full answer plus each alternate it lists, e.g. "A or B" -> ["A or B", "A", "B"].

    Alternates come after the full answer, so ``alternates(a)[1:] or [a]`` is just the
    individual ones."""
    parts = [p.strip() for p in _ALTERNATE_SPLIT_RE.split(answer) if p and p.strip()]
    result = [answer]
    for p in parts:
        if p not in result and soundex.tokenize(p):
            result.append(p)
    return result


def snap_spelling(guess: str, answer: str) -> str:
    """Replace each guess word that is a misspelling of an answer word with that answer word.

    The model treats "nietsche" as a different name from "Nietzsche" (0.11), so typos and ASR
    mis-transcriptions are corrected toward the answer first; the model then judges whether
    the corrected guess is *enough* of an answer. A word counts as a misspelling when it has
    the same Soundex code or is a close character match.
    """
    answer_words = soundex.tokenize(answer)
    if not answer_words:
        return guess
    snapped = []
    for word in re.findall(r"\S+", guess):
        bare = word.lower().strip(".,!?;:'\"")
        if not bare or bare in answer_words or bare.isdigit():
            snapped.append(word)
            continue
        code = soundex.soundex(bare)
        best = None
        for candidate in answer_words:
            if candidate.isdigit():
                continue
            similarity = fuzz.ratio(bare, candidate)
            # Soundex alone is too loose on short words ("high" and "has" are both H200), so a
            # phonetic match also needs some spelling overlap.
            same_sound = code and code == soundex.soundex(candidate) and similarity >= _SNAP_PHONETIC_MIN_RATIO
            if same_sound or similarity >= _SNAP_MIN_RATIO:
                best = candidate
                break
        snapped.append(best or word)
    return " ".join(snapped)


_NUMBER_RE = re.compile(r"\d+")
# "Aaron Copland", "Count Basie": two or three capitalized words and nothing else.
_PERSON_NAME_RE = re.compile(r"[A-Z][\w.'-]*(?: [A-Z][\w.'-]*){1,2}")


def veto(guess: str, answer: str) -> Optional[str]:
    """Reasons to reject a guess outright, for mistakes the model is blind to.

    Measured on the question bank (see project notes), the model accepted 100% of guesses
    that differed from the answer only by a number ("21 Savage" -> "22 Savage", "Symphony
    No. 9" -> "No. 10") and ~90% of first-name-only guesses ("aaron" for Aaron Copland).
    Returns a short reason, or None if the guess may go to the model.
    """
    guess_numbers = set(_NUMBER_RE.findall(guess))
    if guess_numbers - set(_NUMBER_RE.findall(answer)):
        return "wrong_number"

    words = soundex.tokenize(guess)
    if len(words) == 1:
        word = words[0]
        alts = alternates(answer)
        alts = alts[1:] or alts  # the individual alternates, not the whole "A or B" string
        containing = [a for a in alts if word in soundex.tokenize(a)]
        # Only a first name of every alternate it appears in -> not enough to identify anyone.
        if containing and all(
            _PERSON_NAME_RE.fullmatch(a.strip()) and a.split()[0].lower() == word and a.split()[-1].lower() != word
            for a in containing
        ):
            return "first_name_only"
    return None


def is_acronym(guess: str, answer: str) -> bool:
    """Whether the guess is the initials of the answer or one of its alternates.

    "USA", "U.S.A." and "u s a" for "United States of America", "JFK" for "John F. Kennedy".
    The model handles some of these ("USA" 0.93) but not others ("JFK" 0.11), and string
    matching handles none.
    """
    tokens = re.findall(r"[a-z0-9]+", guess.lower())
    if not tokens or not (len(tokens) == 1 or all(len(t) == 1 for t in tokens)):
        return False
    letters = "".join(tokens)
    if len(letters) < 2:
        return False
    for alt in alternates(answer):
        words = re.findall(r"[a-z0-9]+", alt.lower())
        content = soundex.tokenize(alt)
        initials = {"".join(w[0] for w in words), "".join(w[0] for w in content)}
        if len(words) > 1 and all(len(w) == 1 for w in words):  # "M*A*S*H", "The O.C."
            initials.add("".join(words))
        if len(words) > 1 and letters in initials:
            return True
    return False


def _content_words(text: str) -> set:
    words = set()
    for word in soundex.tokenize(text):
        ordinal = _ORDINAL_RE.match(word)
        words.add(ordinal.group(1) if ordinal else _NUMBER_WORDS.get(word, word))
    return words


def _names(candidate: str, part: str, kind: str, min_similarity: float) -> bool:
    """Whether the (spelling-corrected) guess names this part of the answer."""
    part_words = _content_words(part)
    if not part_words:
        return True
    guess_words = _content_words(candidate)
    if kind == "creator":
        # A surname is enough for a person or group ("brahms", "rockingham").
        last = soundex.tokenize(part)
        return fuzz.token_set_ratio(candidate, part) >= min_similarity or bool(last and last[-1] in guess_words)
    return len(part_words & guess_words) / len(part_words) >= MIN_TITLE_COVERAGE


def required_parts(alternate: str, question: str) -> List[tuple]:
    """The parts of one answer alternate a guess has to name, given what the question asks.

    The model can't do this itself: it accepted the composer alone for "Name the piece" 61-94%
    of the time and the artist alone for "What is this song and who made it?" 99% of the time.

    "Prelude by Frederic Chopin" / "Frederic Chopin's Preludes" / "Chopin - Prelude" are split
    into a work and its creator. A two-part question needs both, "Name the composer" needs the
    creator, anything else needs the work ("Beethoven" doesn't name "Symphony No. 6 by
    Beethoven"). An answer with no such structure is required whole.

    Returns ``(text, kind)`` pairs, kind being "creator" (a person or group, which a surname
    names) or "title" (which needs most of its words).
    """
    question = " ".join(question.split())
    work = creator = None
    by = re.fullmatch(r"(.+?)\s+by\s+(.+)", alternate, re.IGNORECASE)
    dash = re.fullmatch(r"(.+?)\s+-\s+(.+)", alternate)
    # Possessive only with a 2+ word owner, so "Three's Company" and "Schindler's List" stay whole.
    possessive = re.fullmatch(r"([A-Z][\w.-]*(?:\s+[\w.-]+){1,3})'s\s+(.+)", alternate)
    if by:
        work, creator = by.groups()
    elif dash:
        if _SCREEN_Q_RE.search(question) and not _TWO_PART_Q_RE.search(question):
            return [(dash.group(1), "title")]
        creator, work = dash.groups()
    elif possessive:
        creator, work = possessive.groups()
    if work is None:
        # Shorthand alternates of a two-part answer ("Mozart VC", "Chopin's Etudes") hold both
        # parts in one string, so they need most of their words like a title does.
        person = _CREATOR_Q_RE.search(question) and not _TWO_PART_Q_RE.search(question)
        return [(alternate, "creator" if person else "title")]
    if _TWO_PART_Q_RE.search(question):
        return [(work, "title"), (creator, "creator")]
    if _CREATOR_Q_RE.search(question):
        return [(creator, "creator")]
    return [(work, "title")]


def _score_one(reference: str, candidate: str, question: str) -> float:
    text = "[CLS] " + candidate + " [SEP] " + reference + " [SEP] " + question + " [SEP]"
    inputs = _tokenizer(text, max_length=512, truncation=True, return_tensors="pt")
    with _torch.no_grad():
        logits = _model(**inputs).logits
    return float(_torch.sigmoid(logits).squeeze()[1])


def score(guess: str, reference: str, question: str = "") -> Optional[float]:
    """Model probability (0-1) that ``guess`` is equivalent to ``reference``, or None if the
    model isn't loaded."""
    if not is_ready():
        return None
    candidate = snap_spelling(guess, reference)
    with _lock:  # torch modules aren't safe to call from several request threads at once
        return _score_one(reference, candidate, question or "")


def judge(guess: str, answer: str, question: str, min_similarity: float, min_score: float) -> Optional[dict]:
    """Decide whether ``guess`` earns the points. None if the model isn't loaded.

    Accepted when the guess is the answer's initials, or when for some alternate of the
    answer (a) the guess, once misspellings are corrected, names every part the question asks
    for (``required_parts``: a surname for a person, most of the words of a title), and (b) the
    model judges the guess equivalent to what was asked (``score >= min_score``). Returns
    ``{"correct": bool, "reason": str, ...}`` so the caller can log why.
    """
    if not is_ready():
        return None
    reason = veto(guess, answer)
    if reason is not None:
        return {"correct": False, "reason": reason}
    if is_acronym(guess, answer):
        return {"correct": True, "reason": "acronym"}
    candidate = snap_spelling(guess, answer)
    best = {"correct": False, "reason": "missing_part"}
    for alt in alternates(answer)[1:] or [answer]:
        parts = required_parts(alt, question or "")
        if not all(_names(candidate, text, kind, min_similarity) for text, kind in parts):
            continue
        # Judge equivalence against only what was asked: "symphony no 1" scored 0.39 against
        # "Symphony No. 1 by Johannes Brahms" for "Name the work." because the composer was missing.
        reference = alt if len(parts) > 1 else parts[0][0]
        model_score = score(guess, reference, question)
        if model_score >= min_score:
            return {"correct": True, "reason": "model_accepts", "alternate": alt, "score": model_score}
        if model_score > best.get("score", -1):
            best = {"correct": False, "reason": "model_rejects", "alternate": alt, "score": model_score}
    return best
