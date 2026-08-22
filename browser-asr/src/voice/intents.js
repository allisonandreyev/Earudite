// Voice navigation command registry.
//
// Each intent is: phrases the user might say -> a guard saying whether it's legal right now ->
// a handler. Kept as plain data so the matcher, the "what can I say" help and any future
// per-screen registration all read from one source.
//
// SCREEN numbers come from the router in WhitePanel.jsx; navigation must set BOTH the atom and
// document.location.hash, because the sidenav does (WhitePanel.jsx:175-181) and the hash is what
// authCallback replays on reload.

export const SCREENS = {
  PROFILE: 1,
  DASHBOARD: 2,
  PLAY: 3,
  RECORD: 4,
  LEADERBOARDS: 5,
  GAME: 6,
  TUTORIAL: 8,
  AI_LEADERBOARD: 9,
  MODEL_PREFERENCES: 10,
};

// Screens where voice navigation is allowed to listen at all. The in-game screen is deliberately
// absent: during a game the mic belongs to the buzz wake word and answer transcription, and a
// second recognizer there both competes for audio and re-renders the game tree.
export const NAV_ALLOWED_SCREENS = [
  SCREENS.PROFILE, SCREENS.DASHBOARD, SCREENS.PLAY, SCREENS.RECORD,
  SCREENS.LEADERBOARDS, SCREENS.TUTORIAL, SCREENS.AI_LEADERBOARD,
  SCREENS.MODEL_PREFERENCES,
];

export function isNavAllowed(screen) {
  return NAV_ALLOWED_SCREENS.indexOf(screen) !== -1;
}

// Navigation intents.
//
// Each has TWO phrase sets, because navigation words and button labels are the same words and
// length-based tie-breaking was not enough to keep them apart — the Record menu kept winning over
// a Record button that was right there on screen.
//
//   phrases — explicit navigation ("go to record", "record menu"). These are unambiguous: nobody
//             says "go to record" meaning a button, so they are matched FIRST, ahead of anything
//             on screen.
//   bare    — the destination name alone ("record"). Matched LAST, only after every on-screen
//             control has failed to match, so a visible button always wins the bare word.
//
// The tiers are assembled in VoiceNav; see matchIntent's callers.
export const NAV_INTENTS = [
  {
    id: 'nav.profile',
    label: 'Profile',
    phrases: ['go to profile', 'open profile', 'profile menu', 'my profile'],
    bare: ['profile'],
    screen: SCREENS.PROFILE,
    hash: 'profile',
  },
  {
    id: 'nav.dashboard',
    label: 'Dashboard',
    phrases: ['go to dashboard', 'open dashboard', 'dashboard menu', 'go home'],
    bare: ['dashboard', 'home'],
    screen: SCREENS.DASHBOARD,
    hash: 'dashboard',
  },
  {
    id: 'nav.play',
    label: 'Play',
    phrases: ['go to play', 'open play', 'play menu', 'play a game', 'start playing'],
    bare: ['play'],
    screen: SCREENS.PLAY,
    hash: 'play',
  },
  {
    id: 'nav.record',
    label: 'Record',
    // The sidenav calls this "Record" but the component is Shop.jsx — users say "record".
    // Bare "record"/"recording" is intentionally last-resort: those words collide with the RECORD
    // buttons in the transcript picker and the Recordings card on Profile.
    phrases: ['go to record', 'open record', 'record menu', 'recording menu', 'record a question',
      'go to recordings', 'open recordings', 'recordings tab', 'recording tab', 'my recordings'],
    bare: ['record', 'recording'],
    screen: SCREENS.RECORD,
    hash: 'record',
  },
  {
    id: 'nav.leaderboards',
    label: 'Leaderboards',
    phrases: ['go to leaderboards', 'open leaderboards', 'leaderboards menu'],
    bare: ['leaderboards', 'leaderboard'],
    screen: SCREENS.LEADERBOARDS,
    hash: 'leaderboards',
  },
  {
    id: 'nav.aiLeaderboard',
    label: 'AI Models',
    phrases: ['ai model leaderboard', 'ai leaderboard', 'ai models', 'model leaderboard'],
    bare: [],
    screen: SCREENS.AI_LEADERBOARD,
    hash: 'ai-leaderboard',
  },
  {
    id: 'nav.modelPreferences',
    label: 'Model Preferences',
    phrases: ['model preferences', 'model prefs', 'open preferences'],
    bare: ['preferences', 'settings'],
    screen: SCREENS.MODEL_PREFERENCES,
    hash: 'model-preferences',
  },
  {
    id: 'nav.tutorial',
    label: 'Tutorial',
    phrases: ['open tutorial', 'show tutorial', 'tutorial menu'],
    bare: ['tutorial', 'help me'],
    screen: SCREENS.TUTORIAL,
    hash: 'tutorial',
  },
];

// "record menu" / "record navigate" / "navigate to record", for every destination that has a bare
// name. Generated rather than hand-listed so a new NAV_INTENT can't quietly miss the phrasing that
// distinguishes "go to the menu" from "press the button of the same name".
NAV_INTENTS.forEach((intent) => {
  (intent.bare || []).forEach((word) => {
    [word + ' menu', word + ' navigate', 'navigate to ' + word].forEach((phrase) => {
      if (intent.phrases.indexOf(phrase) === -1) intent.phrases.push(phrase);
    });
  });
});

// Same intents, exposing only their bare names — matched after on-screen controls.
export const NAV_BARE_INTENTS = NAV_INTENTS
  .filter((i) => i.bare && i.bare.length)
  .map((i) => ({ ...i, id: i.id, phrases: i.bare }));

// Non-navigation commands handled by the listener itself.
export const META_INTENTS = [
  { id: 'meta.help', label: 'What can I say', phrases: ['what can i say', 'list commands', 'voice help'] },
  { id: 'meta.stop', label: 'Stop listening', phrases: ['stop listening', 'voice off', 'disable voice'] },
];

// Confirmation responses for intents flagged `confirm: true`. While a confirmation is pending
// these are the ONLY phrases VoiceNav matches, so an unrelated utterance cannot execute a
// destructive action by accident.
export const CONFIRM_YES = {
  id: 'confirm.yes',
  label: 'Yes',
  phrases: ['yes', 'yeah', 'confirm', 'do it', 'go ahead'],
};
export const CONFIRM_NO = {
  id: 'confirm.no',
  label: 'No',
  phrases: ['no', 'cancel', 'nevermind', 'never mind', 'stop'],
};

// Normalize for matching, and deliberately DESTROY the singular/plural distinction.
//
// ASR drops and invents trailing sibilants constantly — "view older leaderboard" for a button
// reading "View Older Leaderboards", "recordings" for "recording". Trying to enumerate both forms
// everywhere was losing that fight, so instead every word is stemmed the same way on both sides
// of the comparison. Nothing downstream ever sees a plural.
//
// It also strips -ing and -ed, for the same reason: the recognizer regularly swallows the ending
// outright, returning "record" for a spoken "recordings". Enumerating word forms per control was
// always going to lose that fight — collapsing every form to one stem on both sides wins it once.
//
// So: recordings -> recording -> record, submitting -> submit, creating -> create -> creat.
// The stems need not be real words, only consistent, because the same function runs over the
// spoken text and over every registered phrase.
//
// Words of 4 characters or fewer are left alone ("yes" must not become "ye"), and a trailing "ss"
// is protected so "press" does not become "pres".
function stemWord(w) {
  if (w.length <= 4) return w;

  // plural / third person
  if (/ies$/.test(w)) w = w.slice(0, -3) + 'y';
  else if (/(ches|shes|xes|zes|ses)$/.test(w)) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);

  // gerund / past participle
  let stripped = false;
  if (/ing$/.test(w) && w.length > 5) { w = w.slice(0, -3); stripped = true; }
  else if (/ed$/.test(w) && w.length > 4) { w = w.slice(0, -2); stripped = true; }

  // Collapse the consonant doubled by that ending (submitting -> submitt -> submit). Only after an
  // actual strip, otherwise legitimate double letters get eaten ("press" -> "pres").
  if (stripped && w.length > 3) {
    const a = w[w.length - 1];
    if (a === w[w.length - 2] && 'aeiou'.indexOf(a) === -1) w = w.slice(0, -1);
  }

  // Drop a trailing silent e so the -e verbs converge too (create/creating -> creat).
  if (/e$/.test(w) && w.length > 3) w = w.slice(0, -1);

  return w;
}

// Exported so control discovery can group duplicates on exactly the key matching uses. Grouping on
// the raw label instead let "Record", "Recording" and "Recordings" pass as three distinct controls
// that then all collided at match time — no numbering was generated, so "record one" matched
// nothing while bare "record" hit an arbitrary one.
export function normalizePhrase(text) {
  return normalize(text);
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(stemWord)
    .join(' ')
    .trim();
}

// Match the TAIL of the transcript, not the whole thing. Web Speech accumulates across a
// continuous session, so the newest words are at the end; comparing whole-transcript would stop
// matching after the first utterance.
//
// A phrase matches when it appears as a suffix of the normalized transcript, or as the final
// words of it. This is intentionally stricter than substring-anywhere: "play" appearing early in
// a long transcript should not keep re-triggering navigation.
export function matchIntent(transcript, intents) {
  const text = normalize(transcript);
  if (!text) return null;
  let best = null;
  for (const intent of intents) {
    for (const phrase of intent.phrases) {
      const p = normalize(phrase);
      if (text === p || text.endsWith(' ' + p)) {
        // Prefer the longest phrase matched, so "go to profile" beats bare "profile".
        if (!best || p.length > best.phraseLength) {
          best = { intent, phrase: p, phraseLength: p.length };
        }
      }
    }
  }
  return best;
}

export const ALL_INTENTS = NAV_INTENTS.concat(META_INTENTS);

// Ordered match tiers. Earlier tiers win outright — not by phrase length — so an on-screen button
// can never be beaten by the menu that happens to share its name.
//
//   1. explicit navigation ("go to record")  — unambiguous intent to leave this screen
//   2. commands a screen registered          — hand-written, most specific
//   3. controls visible right now            — the button the user is looking at
//   4. bare destination names ("record")     — only when nothing on screen matched
//   5. meta ("what can i say")
export function matchTiered(transcript, registeredIntents, screenControls) {
  const tiers = [
    NAV_INTENTS,
    registeredIntents || [],
    screenControls || [],
    NAV_BARE_INTENTS,
    META_INTENTS,
  ];
  for (const tier of tiers) {
    const m = matchIntent(transcript, tier);
    if (m) return m;
  }
  return null;
}


// Words for picking one of several identical controls. Both series are accepted because people
// reach for either ("two" / "second"), and each is a SINGLE word — the bare form matters, since a
// two-word command has to survive the recognizer splitting an utterance in half.
export const ORDINAL_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
export const ORDINAL_NAMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

// What the recognizer hands back for a spoken number, which is very often NOT the word.
//
// Web Speech writes numbers as digits once they follow another word — "record one" comes back as
// "record 1" — and the small numbers have common homophones it picks by context it doesn't have
// here ("to"/"too" for two, "for" for four, "won" for one). Every one of these was a choice that
// silently did nothing, so each ordinal answers to its digit and its soundalikes as well.
export const ORDINAL_ALIASES = [
  ['1', 'won'],
  ['2', 'to', 'too'],
  ['3'],
  ['4', 'for', 'fore'],
  ['5'],
  ['6'],
  ['7'],
  ['8', 'ate'],
];

// Phrases that address the nth control (1-based) of a duplicated group by name and position:
// "record two", "record number 2", "record second". Label-prefixed only — the bare "two" belongs
// to choiceIntents, which is registered solely while a choice is pending, so it can never fire on
// a screen that isn't asking which one.
export function groupOrdinalPhrases(label, n) {
  const i = n - 1;
  if (i < 0 || i >= ORDINAL_WORDS.length) return [];
  const forms = [ORDINAL_WORDS[i], ORDINAL_NAMES[i]].concat(ORDINAL_ALIASES[i]);
  const out = [];
  forms.forEach((f) => {
    out.push(label + ' ' + f);
    out.push(label + ' number ' + f);
  });
  return out;
}

// Intents for choosing among `count` controls that share `label`.
//
// Registered only while a choice is actually pending, so bare "two" can never fire anything on a
// screen that isn't asking which one. `index` is 0-based into the group, in DOM order.
export function choiceIntents(label, count) {
  const out = [];
  const n = Math.min(count, ORDINAL_WORDS.length);
  for (let i = 0; i < n; i++) {
    const forms = [ORDINAL_WORDS[i], ORDINAL_NAMES[i]].concat(ORDINAL_ALIASES[i]);
    const bare = ['the ' + ORDINAL_NAMES[i]];
    forms.forEach((f) => { bare.push(f); bare.push('number ' + f); });
    out.push({
      id: 'choice.' + (i + 1),
      label: label + ' ' + ORDINAL_WORDS[i],
      index: i,
      phrases: bare.concat(groupOrdinalPhrases(label, i + 1)),
    });
  }
  return out;
}

// The menu this group of controls shares its name with, if any.
//
// "Record" is both four buttons on the transcript picker and a place in the sidenav, and while the
// picker is up the buttons win — correctly, but that left no way to say "actually, take me to the
// menu". This pairs the two so the choice prompt can offer it alongside the buttons.
export function navIntentForGroup(groupKey) {
  const key = normalize(groupKey);
  for (const intent of NAV_INTENTS) {
    const names = (intent.bare || []).concat([intent.label]);
    for (const name of names) {
      if (normalize(name) === key) return intent;
    }
  }
  return null;
}

// The extra "take me to the menu instead" option offered during a choice. Kept out of
// choiceIntents so a group with no matching destination simply doesn't get one.
export function menuChoiceIntent(label, navIntent) {
  return {
    id: 'choice.menu',
    label: navIntent.label + ' menu',
    navIntent: navIntent,
    phrases: ['menu', 'navigate', 'go to menu', 'open menu', 'the menu',
      label + ' menu', label + ' navigate'],
  };
}

// Could what we just matched be the first half of a longer command that is still arriving?
//
// Web Speech delivers a sentence in pieces, so "record two" reaches us as "record" and only then
// as "record two". Acting on the first piece ran the wrong command AND consumed the utterance, so
// the trailing word arrived alone and matched nothing — the reason two-word commands appeared to
// need a long pause between them. Callers use this to wait for the utterance to settle instead.
export function hasExtension(matchedPhrase, tiers) {
  if (!matchedPhrase) return false;
  const prefix = matchedPhrase + ' ';
  for (const tier of tiers) {
    if (!tier) continue;
    for (const intent of tier) {
      for (const phrase of intent.phrases) {
        const p = normalize(phrase);
        if (p.length > matchedPhrase.length && p.indexOf(prefix) === 0) return true;
      }
    }
  }
  return false;
}
