"""American Soundex phonetic encoding, used to accept answers that sound right but are
spelled (or transcribed) wrong.

The game feeds both typed answers and ASR transcripts into ``/answer``, and both produce
the same class of miss: the player knew the answer but the string does not match
("nietzsche" -> "neechee", "hoolihan" -> "houlihan"). Soundex collapses those onto the
same code, so ``check_answer`` can fall back to a phonetic comparison when the literal
one fails.

Reference: https://en.wikipedia.org/wiki/Soundex
"""
import re
from typing import List

# Consonants that share a digit. Vowels (and Y) map to "0", which separates repeated
# digits without being emitted; H and W are dropped entirely and do NOT separate.
_CODES = {
    "B": "1", "F": "1", "P": "1", "V": "1",
    "C": "2", "G": "2", "J": "2", "K": "2", "Q": "2", "S": "2", "X": "2", "Z": "2",
    "D": "3", "T": "3",
    "L": "4",
    "M": "5", "N": "5",
    "R": "6",
    "A": "0", "E": "0", "I": "0", "O": "0", "U": "0", "Y": "0",
}

_NON_ALPHA_RE = re.compile(r"[^A-Z]")
_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Words too common to carry any signal. A one-word guess of "the" would otherwise be a
# subset of nearly every answer and score 100.
_STOPWORDS = frozenset({
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "from", "by",
    "with", "is", "was", "were", "are", "be", "been", "as", "it", "its", "this", "that",
    "these", "those", "his", "her", "hers", "their", "theirs", "our", "your", "my",
    "he", "she", "they", "we", "you", "i", "s",
})


def soundex(word: str) -> str:
    """Encode a single word as a 4-character American Soundex code (e.g. "Robert" -> "R163").

    Returns an empty string if the word has no letters.
    """
    word = _NON_ALPHA_RE.sub("", word.upper())
    if not word:
        return ""

    code = word[0]
    # The first letter's own digit still suppresses a duplicate right after it
    # ("Pfister" -> P236, not P123).
    previous = _CODES.get(code, "0")

    for char in word[1:]:
        digit = _CODES.get(char)
        if digit is None:  # H and W are transparent: they don't break a repeated digit
            continue
        if digit != "0" and digit != previous:
            code += digit
            if len(code) == 4:
                break
        previous = digit

    return (code + "000")[:4]


def tokenize(text: str) -> List[str]:
    """Split an answer into comparable, meaningful tokens (stopwords removed)."""
    tokens = _TOKEN_RE.findall(text.lower())
    return [t for t in tokens if t not in _STOPWORDS]


def encode_phrase(text: str) -> str:
    """Encode every meaningful word of a phrase, e.g. "George Washington" -> "G622 W252".

    Purely numeric tokens are passed through unchanged so that "1984" and "1985" stay
    distinguishable. Returns an empty string when the phrase carries no signal.
    """
    codes = []
    for token in tokenize(text):
        codes.append(token if token.isdigit() else soundex(token))
    return " ".join(c for c in codes if c)
