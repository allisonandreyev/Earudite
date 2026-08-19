import { normalizePhrase } from './intents';

// Context-aware control discovery.
//
// Goal: saying "record" while a Record button is on screen should PRESS that button, not navigate
// to the Record menu. So whatever is currently visible has to become a voice command
// automatically, without every screen hand-registering its buttons.
//
// This reads the DOM rather than doing OCR on a screenshot. It is the same idea, but strictly
// better here because the app owns its own markup: exact button text instead of character-
// recognition guesses, real click dispatch instead of synthetic coordinates, no screenshot
// latency, and it still works for controls that are scrolled, low-contrast or icon-adjacent.
//
// The app has no button semantics to lean on — a grep for role/tabIndex/aria across every
// component returns zero, and essentially every control is a bare <div onClick> — so selection is
// driven by this codebase's actual class-naming conventions plus real <button>/<a>/<select>.

// Matched against how this codebase actually names things, which is inconsistent: "-btn"
// (audiorecorder-btn), "btn-" (btn-wrapper), no separator at all (game-quitbtn), a bare "button"
// token (whitepanel-tutorial button), and "-selector-wrapper" for the difficulty cards. Substring
// matches on "btn"/"button" cover all of those; the innermost filter below keeps the extra
// container hits from winning over the real control.
const CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  'a[href]',
  '[class*="btn"]',
  '[class*="button"]',
  '[class*="selector-wrapper"]',
].join(', ');

// The sidenav is deliberately NOT scanned. Its items are navigation, and NAV_INTENTS already
// covers every one of them — including under "go to X" phrasing. Scanning it too meant the
// sidenav's "Record" item and an on-screen RECORD button produced the same phrase, the duplicate
// rule discarded both, and "record" fell through to navigation. Excluding it makes the split
// unambiguous: a bare button word presses the button on screen, "go to X" navigates.
const NAV_REGION_SELECTOR = '[class*="sidenav"]';

// Words people use for a control that is labelled something adjacent. Keyed by the control's
// normalized label; the values become extra phrases for it.
const LABEL_SYNONYMS = {
  refresh: ['reload', 'update', 'refresh the leaderboard'],
  reload: ['refresh', 'update'],
  update: ['refresh', 'reload'],
  back: ['go back', 'return'],
  cancel: ['go back', 'nevermind'],
  reroll: ['shuffle', 'different questions', 'new questions'],
  create: ['create lobby', 'new lobby'],
  join: ['join lobby'],
  start: ['start game'],
  submit: ['send answer'],
};

// Text that should never fire from a single utterance without confirming first.
const DESTRUCTIVE = /\b(quit|leave|logout|log out|sign out|delete|remove|submit|register)\b/i;

// Common inflections of a control's label, so a button reading "Record" also answers to
// "recording" / "records" / "recorded".
//
// This matters more than it looks. Navigation intents carry gerund phrasings too ("recording" is
// a phrase on nav.record), and ASR readily turns a spoken "record" into "recording". Without
// these variants the on-screen button offers only the 6-character "record", the navigation intent
// wins with a 9-character exact match, and pressing the button by voice becomes impossible.
// Generating them here means the button ties the navigation phrase and wins on ordering, because
// screen controls are matched ahead of global intents.
//
// Deliberately over-generates (both "submiting" and "submitting"): a phrase nobody says is dead
// weight, whereas a missing one is a command that doesn't work.
function inflections(word) {
  if (!word || word.length < 3) return [];
  const out = [];
  const isVowel = (c) => 'aeiou'.indexOf(c) !== -1;
  const last = word[word.length - 1];
  const prev = word[word.length - 2];

  if (/(s|sh|ch|x|z)$/.test(word)) out.push(word + 'es');
  else if (last === 'y' && !isVowel(prev)) out.push(word.slice(0, -1) + 'ies');
  else out.push(word + 's');

  if (last === 'e') {
    out.push(word.slice(0, -1) + 'ing');
    out.push(word + 'd');
  } else {
    out.push(word + 'ing');
    out.push(word + 'ed');
    // consonant-vowel-consonant usually doubles: submit -> submitting
    if (!isVowel(last) && isVowel(prev) && word.length > 3 && !isVowel(word[word.length - 3])) {
      out.push(word + last + 'ing');
      out.push(word + last + 'ed');
    }
  }
  return out;
}

// The reverse direction: strip suffixes back toward the stem, so a button labelled "Recordings"
// also answers to "recording" and "record".
//
// Needed because inflection only goes one way. A "Record" button gains "recording", but a
// "Recordings" button gained nothing shorter — so saying "recording" on the Profile screen matched
// only the navigation intent and bounced the user to the Record menu instead of opening their
// recording history.
function deinflections(word) {
  const out = [];
  const push = (w) => { if (w.length >= 3 && out.indexOf(w) === -1) out.push(w); };
  let base = word;
  if (/ies$/.test(base)) push(base = base.slice(0, -3) + 'y');
  else if (/(ses|shes|ches|xes|zes)$/.test(base)) push(base = base.slice(0, -2));
  else if (/s$/.test(base) && !/ss$/.test(base)) push(base = base.slice(0, -1));
  // Now peel a gerund/past off whatever we have (recordings -> recording -> record).
  const stem = base;
  if (/ing$/.test(stem)) {
    const cut = stem.slice(0, -3);
    push(cut);
    if (cut.length > 2 && cut[cut.length - 1] === cut[cut.length - 2]) push(cut.slice(0, -1)); // submitting -> submit
    push(cut + 'e');   // creating -> create
  }
  if (/ed$/.test(stem)) {
    const cut = stem.slice(0, -2);
    push(cut);
    push(cut + 'e');
  }
  return out;
}

// Expand a phrase by inflecting its LAST word, which is the one carrying the action. Both
// directions, so the control matches whichever form the speaker (or the recognizer) produced.
function withInflections(phrase) {
  const parts = phrase.split(' ');
  const head = parts.slice(0, -1).join(' ');
  const tail = parts[parts.length - 1];
  const variants = inflections(tail).concat(deinflections(tail));
  return variants.map((v) => (head ? head + ' ' + v : v));
}

// Containers frequently match the class heuristics too. Prefer the innermost match so "Submit"
// clicks the button rather than the panel wrapping it.
function isInnermost(el, all) {
  for (const other of all) {
    if (other !== el && el.contains(other)) return false;
  }
  return true;
}

function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  return true;
}

function labelOf(el) {
  // innerText first (what a sighted user reads), then textContent — several icon-only controls
  // here carry their name in a visually-hidden <span class="label-hidden">, which innerText
  // omits precisely because it is hidden. That span is the only name those buttons have.
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  return (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
}

// Build voice intents for everything clickable and visible right now.
// Candidate set = explicit control selectors UNION everything the stylesheet marks clickable with
// `cursor: pointer`.
//
// The class-name heuristics alone missed real buttons whose names follow no pattern
// (play-gamemodecard-start = CREATE/START/JOIN, shop-sentences-submit, whitepanel-tutorial,
// leaderboards-topic-wrapper, and 16 more). Rather than maintain a hand-written list that silently
// rots as the UI changes, key off the thing the CSS already uses to say "this is clickable". New
// buttons then become voice-addressable automatically.
//
// Cost is bounded: this only runs while voice navigation is enabled, never on the in-game screen,
// and the result is cached for CACHE_MS.
function collectCandidates() {
  const set = [];
  const seen = typeof Set === 'function' ? new Set() : null;
  const add = (el) => {
    if (seen) { if (seen.has(el)) return; seen.add(el); }
    else if (set.indexOf(el) !== -1) return;
    set.push(el);
  };
  try {
    Array.prototype.forEach.call(document.querySelectorAll(CONTROL_SELECTOR), add);
  } catch (e) { /* selector unsupported — fall through to the cursor pass */ }
  try {
    const all = document.body ? document.body.querySelectorAll('*') : [];
    Array.prototype.forEach.call(all, (el) => {
      if (!el.getBoundingClientRect) return;
      const style = window.getComputedStyle(el);
      if (!style || style.cursor !== 'pointer') return;
      // `cursor` INHERITS, so every descendant of a clickable element also reports "pointer".
      // Taking them all made the real button non-innermost — an icon child would knock out its
      // own parent, and since the icon has no text the control disappeared entirely. That killed
      // every icon-bearing button ("<ArchiveIcon/> View Older Leaderboards", the Profile history
      // cards, and most others in this app).
      //
      // The genuinely clickable node is where the pointer style STARTS: keep it only if the
      // parent isn't also pointer.
      const parent = el.parentElement;
      if (parent) {
        const pstyle = window.getComputedStyle(parent);
        if (pstyle && pstyle.cursor === 'pointer') return;
      }
      add(el);
    });
  } catch (e) { /* ignore */ }
  return set;
}

export function scanControls() {
  let nodes;
  try {
    nodes = collectCandidates();
  } catch (e) {
    return [];
  }
  const visible = nodes.filter(isVisible);
  const leaves = visible.filter((el) => isInnermost(el, visible));

  // Collect first, then decide phrasing — a label's phrasing depends on whether anything else on
  // screen shares it, which isn't known until every control has been seen.
  const found = [];
  leaves.forEach((el) => {
    if (el.closest && el.closest(NAV_REGION_SELECTOR)) return;   // sidenav is navigation, not action
    const label = labelOf(el);
    // Long strings are prose, not buttons; empty ones give the user nothing to say.
    if (!label || label.length > 32) return;
    const phrase = label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!phrase) return;
    found.push({ el, label, phrase });
  });

  // Group on the STEMMED phrase, i.e. the exact key the matcher will compare against. Two controls
  // whose labels differ only by an ending ("Record" / "Recordings") are indistinguishable once
  // matched, so they must be treated as duplicates here or they collide silently.
  found.forEach((f) => { f.key = normalizePhrase(f.phrase) || f.phrase; });
  const counts = {};
  found.forEach((f) => { counts[f.key] = (counts[f.key] || 0) + 1; });

  const ORDINALS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const seenIndex = {};

  // For a label that appears more than once, the bare word can't select a specific control — but
  // letting it fall through to navigation is worse than useless, because the user is looking
  // straight at the buttons they meant. Register the bare word (and its inflections) as an
  // explicit "which one?" prompt instead.
  const ambiguous = Object.keys(counts)
    .filter((key) => counts[key] > 1)
    .map((phrase) => ({
      id: 'dom.ambiguous.' + phrase.replace(/\s+/g, '_'),
      label: phrase,
      phrases: [phrase, 'click ' + phrase, 'press ' + phrase].concat(withInflections(phrase)),
      source: 'screen',
      ambiguous: true,
      count: counts[phrase],
      run: () => {},
    }));

  return ambiguous.concat(found.map((f, i) => {
    const duplicated = counts[f.key] > 1;
    seenIndex[f.key] = (seenIndex[f.key] || 0) + 1;
    const n = seenIndex[f.key];

    let phrases;
    if (duplicated) {
      // Several identical buttons (the transcript picker shows four RECORDs). Address them by
      // position rather than dropping them — silently doing nothing is worse than asking the user
      // to say which. The bare word is intentionally NOT registered, so it stays available for a
      // navigation intent instead of clicking an arbitrary one.
      // Number off the SHARED stem, not each control's own label, so a group of "Record" /
      // "Recording" / "Recordings" reads as "record one / two / three" instead of three different
      // prefixes. Matching stems both sides anyway, so this is purely so the help panel and the
      // "which one?" prompt agree on what to say.
      const ord = ORDINALS[n - 1];
      phrases = ord ? [f.key + ' ' + ord, f.key + ' number ' + ord] : [];
    } else {
      phrases = [f.phrase, 'click ' + f.phrase, 'press ' + f.phrase];
      const syn = LABEL_SYNONYMS[f.phrase];
      if (syn) phrases = phrases.concat(syn);
      phrases = phrases.concat(withInflections(f.phrase));
    }

    return {
      id: 'dom.' + i + '.' + f.phrase.replace(/\s+/g, '_'),
      label: duplicated ? f.label + ' (' + n + ')' : f.label,
      phrases: phrases,
      source: 'screen',
      confirm: DESTRUCTIVE.test(f.label),
      run: () => { try { f.el.click(); } catch (e) { /* detached between scan and speech */ } },
    };
  })).filter((x) => x.phrases.length > 0);
}

// Matching runs on every interim transcript update, which is frequent, so the scan is cached
// briefly. The DOM only changes on interaction, and a stale entry is harmless — its element is
// either still there or the click is a no-op.
let cache = { at: 0, intents: [] };
const CACHE_MS = 700;

export function getScreenControls() {
  const now = Date.now();
  if (now - cache.at < CACHE_MS) return cache.intents;
  cache = { at: now, intents: scanControls() };
  return cache.intents;
}
