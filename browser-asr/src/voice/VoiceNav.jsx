import { useState, useEffect, useRef, useCallback } from "react";
import { useRecoilState } from "recoil";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import { SCREEN } from "../store";
import {
  NAV_INTENTS, NAV_BARE_INTENTS, META_INTENTS, CONFIRM_YES, CONFIRM_NO, ORDINAL_WORDS,
  matchIntent, matchTiered, isNavAllowed, choiceIntents, hasExtension,
  navIntentForGroup, menuChoiceIntent,
} from "./intents";
import { getRegisteredIntents } from "./registry";
import {
  getScreenControls, getGroupControls, findNavItem, showChoiceBadges, clearChoiceBadges,
} from "./domControls";
import "../styles/VoiceNav.css";

const STORAGE_KEY = 'earudite_voice_nav_enabled';

// How long to wait for the rest of a sentence once what we heard could be the start of a longer
// command. Web Speech delivers "record two" as "record" and then "record two", so acting on the
// first piece runs the wrong command and eats the trailing word. Long enough to catch the second
// word, short enough that an unambiguous command still feels immediate.
const SETTLE_MS = 650;

// Suppress a repeat of the command just run (interim results re-deliver the same tail as the
// recognizer refines it). Deliberately per-command: a *different* match must never be blocked.
const REPEAT_MS = 1800;

// A pending "which one?" gives up on its own rather than leaving numbers stuck on screen.
const CHOICE_TIMEOUT_MS = 12000;

// resetTranscript() aborts the recognizer and opens a new session, and speech during that restart
// is lost — so it is never called on a command any more, only during a lull, and only once the
// accumulated string is actually long enough to be worth the interruption. Matching is
// suffix-based, so a long transcript is a performance concern and nothing more.
const MAX_TRANSCRIPT_CHARS = 400;
const IDLE_RESET_MS = 5000;

function loadEnabled() {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
}
function saveEnabled(on) {
  try { window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* private mode */ }
}

// Voice navigation.
//
// MOUNTED AS A SIBLING OF BigWhitePanel IN index.tsx, NOT INSIDE IT. That placement is load-
// bearing: useSpeechRecognition subscribes this component to react-speech-recognition's singleton
// manager and re-renders it on every recognizer update. If that subscription lived anywhere above
// the router, those re-renders would cascade into Game -> AnswerBox, whose createScriptProcessor
// callback runs on the main thread — starving the audio pipeline that the buzz wake word and
// answer transcription depend on. As a sibling, its re-renders stay local to itself.
//
// It also refuses to listen on the in-game screen at all (isNavAllowed), so during a game there is
// no second recognizer competing for the microphone.
//
// TIMING. A command is not executed the moment it matches. The recognizer emits a sentence in
// pieces, and the first piece is often a complete command in its own right ("record" on the way to
// "record two"), so the listener waits out SETTLE_MS whenever a longer registered phrase begins
// with what it just heard. Everything else fires immediately.
function VoiceNav() {
  const [screen, setScreen] = useRecoilState(SCREEN);
  const [enabled, setEnabled] = useState(loadEnabled);
  const [heard, setHeard] = useState('');
  const [acted, setActed] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [pending, setPending] = useState(null);   // destructive intent awaiting "yes"
  const [choosing, setChoosing] = useState(null); // duplicate controls awaiting "one" / "two" / …
  const [noMatch, setNoMatch] = useState(false);
  const lastActionAtRef = useRef(0);
  const lastIntentRef = useRef('');
  const settleRef = useRef(null);
  const idleResetRef = useRef(null);
  const transcriptRef = useRef('');
  // A settle timer fires up to SETTLE_MS after the render that armed it, by which point a
  // confirmation or a choice may have opened or closed. It reads these rather than the closure so
  // it always decides against the state that is actually current.
  const pendingRef = useRef(null);
  const choosingRef = useRef(null);

  const { transcript, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();
  transcriptRef.current = transcript;
  pendingRef.current = pending;
  choosingRef.current = choosing;

  const allowed = isNavAllowed(screen);
  const active = enabled && allowed && browserSupportsSpeechRecognition;

  useEffect(() => {
    if (active) {
      resetTranscript();
      SpeechRecognition.startListening({ continuous: true });
    } else {
      SpeechRecognition.abortListening();
    }
    return () => { SpeechRecognition.abortListening(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const navigate = useCallback((intent) => {
    setScreen(intent.screen);
    // The sidenav sets both; authCallback replays the hash on reload, so skipping it would make a
    // voice-navigated screen revert on refresh.
    document.location.hash = intent.hash;
  }, [setScreen]);

  const runIntent = useCallback((intent) => {
    if (intent.ambiguous) {
      // Several controls share this label. Number them on screen and take the next word as the
      // pick — a bare "two" is accepted, so answering never depends on the recognizer keeping two
      // words in one piece.
      // A duplicated label very often IS also a place to go — "record" names both these buttons
      // and the sidenav tab. Offering only the buttons left no way out of that, so the menu is
      // labelled too, on the sidenav item it leads to.
      const nav = navIntentForGroup(intent.group);
      const choice = { group: intent.group, label: intent.label, count: intent.count, nav: nav };
      choosingRef.current = choice;   // the next utterance may land before the re-render
      setChoosing(choice);

      const entries = getGroupControls(intent.group)
        .map((c, i) => ({ el: c.el, word: ORDINAL_WORDS[i] }))
        .filter((e) => e.word);
      if (nav) {
        const navEl = findNavItem(nav.label);
        if (navEl) entries.push({ el: navEl, word: 'menu', hint: 'to go to the ' + nav.label + ' menu' });
      }
      showChoiceBadges(entries);

      // The phrases themselves are now written on the controls, so the readout points at them
      // instead of repeating a list the user would have to map onto the screen themselves.
      setActed('Which one? say the word on it');
      return;
    }
    if (intent.id === 'meta.help') {
      setShowHelp(true);
      setActed('Showing commands');
      return;
    }
    if (intent.id === 'meta.stop') {
      setEnabled(false);
      saveEnabled(false);
      setActed('Voice off');
      return;
    }
    if (intent.run) {           // screen-local action from the registry
      intent.run();
      setActed('✓ ' + intent.label);
      setShowHelp(false);
      return;
    }
    navigate(intent);           // navigation intent
    setActed('→ ' + intent.label);
    setShowHelp(false);
  }, [navigate]);

  useEffect(() => {
    if (!active || !transcript) return;
    setHeard(transcript.split(' ').slice(-6).join(' '));

    // What is listened for depends on what is outstanding:
    //   a pending confirmation -> yes/no only, so a stray phrase can't quit your lobby
    //   a pending choice       -> ordinals only, so "two" can't press something else
    //   otherwise              -> the normal tiers (see matchTiered)
    function decide(text) {
      if (pendingRef.current) {
        const tier = [CONFIRM_YES, CONFIRM_NO];
        return { match: matchIntent(text, tier), tiers: [tier] };
      }
      if (choosingRef.current) {
        const c = choosingRef.current;
        let tier = choiceIntents(c.label, c.count);
        if (c.nav) tier = tier.concat([menuChoiceIntent(c.label, c.nav)]);
        tier = tier.concat([CONFIRM_NO]);
        return { match: matchIntent(text, tier), tiers: [tier] };
      }
      const registered = getRegisteredIntents();
      const controls = getScreenControls();
      return {
        match: matchTiered(text, registered, controls),
        tiers: [NAV_INTENTS, registered, controls, NAV_BARE_INTENTS, META_INTENTS],
      };
    }

    function commit(intent) {
      const now = Date.now();
      // Interim results re-deliver the same tail repeatedly. Suppress a repeat of the command just
      // run — but only that one. Blocking a *different* command inside a fixed window is what used
      // to swallow the second half of "record two", because the "which one?" prompt fired on
      // "record" and then held the lock while "record two" arrived.
      if (intent.id === lastIntentRef.current && now - lastActionAtRef.current < REPEAT_MS) return;
      lastIntentRef.current = intent.id;
      lastActionAtRef.current = now;

      if (choosingRef.current) {
        clearChoiceBadges();
        const group = choosingRef.current;
        choosingRef.current = null;
        setChoosing(null);
        if (intent.id === 'confirm.no') { setActed('Cancelled'); return; }
        if (intent.navIntent) { runIntent(intent.navIntent); return; }
        const target = getGroupControls(group.group)[intent.index];
        if (target) { target.run(); setActed('✓ ' + target.label); }
        else setActed('That one is no longer on screen');
        return;
      }

      if (pendingRef.current) {
        const target = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        if (intent.id === 'confirm.yes') runIntent(target);
        else setActed('Cancelled');
        return;
      }

      // Destructive actions (quitting a lobby, leaving a game) ask first. A misheard "quit" that
      // fires immediately is the worst failure this feature can have.
      if (intent.confirm) {
        pendingRef.current = intent;
        setPending(intent);
        setActed('Say "yes" to ' + intent.label.toLowerCase());
        return;
      }

      runIntent(intent);
    }

    const { match, tiers } = decide(transcript);

    if (!match) {
      // A settle timer already armed is deliberately left running: the words that broke the match
      // may be noise, and its fallback still runs the command that did match.
      // Say so, rather than failing silently. A command that matches nothing used to look
      // identical to one the recognizer never heard, which made every failure undiagnosable —
      // including from the user's side. Showing the tail we tried to match tells you whether the
      // problem is recognition (wrong words) or matching (right words, no command).
      setNoMatch(true);
      return;
    }
    setNoMatch(false);

    clearTimeout(settleRef.current);
    if (hasExtension(match.phrase, tiers)) {
      // Heard a complete command that is also the opening of a longer one. Give the rest of the
      // sentence a chance to arrive, then match again against whatever the transcript ended up
      // being — "record" alone still runs once the user stops there.
      const heardMatch = match;
      settleRef.current = setTimeout(() => {
        // Re-match against whatever the sentence turned out to be. If the extra words made it
        // match nothing (a cough, a half-finished thought), fall back to what was already a
        // complete command rather than dropping it.
        const settled = decide(transcriptRef.current);
        commit((settled.match || heardMatch).intent);
      }, SETTLE_MS);
      return;
    }
    commit(match.intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, active, pending, choosing, runIntent]);

  useEffect(() => () => clearTimeout(settleRef.current), []);

  // Trim the accumulated transcript, but only while nobody is talking — see MAX_TRANSCRIPT_CHARS.
  useEffect(() => {
    clearTimeout(idleResetRef.current);
    if (!active || transcript.length < MAX_TRANSCRIPT_CHARS) return;
    idleResetRef.current = setTimeout(() => resetTranscript(), IDLE_RESET_MS);
    return () => clearTimeout(idleResetRef.current);
  }, [transcript, active, resetTranscript]);

  // Don't leave numbers on screen if the user never answers.
  useEffect(() => {
    if (!choosing) return;
    const t = setTimeout(() => {
      clearChoiceBadges();
      choosingRef.current = null;
      setChoosing(null);
      setActed('');
    }, CHOICE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [choosing]);

  // Drop a dangling confirmation or choice if the screen changes out from under it, and clear the
  // transient readout so a stale "heard" line doesn't linger.
  useEffect(() => {
    pendingRef.current = null;
    choosingRef.current = null;
    setPending(null);
    setChoosing(null);
    clearChoiceBadges();
    setHeard('');
    setActed('');
    setNoMatch(false);
  }, [screen]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    saveEnabled(next);
    if (!next) { setShowHelp(false); clearChoiceBadges(); choosingRef.current = null; setChoosing(null); }
  }

  if (!browserSupportsSpeechRecognition) return null;
  // Nothing to offer on the login/loading screens or mid-game.
  if (!allowed) return null;

  return (
    <div class="voicenav-wrapper">
      {showHelp && (
        <div class="voicenav-help">
          {getRegisteredIntents().concat(getScreenControls()).length > 0 && (
            <>
              <div class="voicenav-help-title">On this screen</div>
              {getRegisteredIntents().concat(getScreenControls()).map((i) => (
                <div key={i.id} class="voicenav-help-row">
                  <span class="voicenav-help-phrase">"{i.phrases[0]}"</span>
                  {i.confirm && <span class="voicenav-help-confirm">asks first</span>}
                </div>
              ))}
            </>
          )}
          <div class="voicenav-help-title">Go to</div>
          {NAV_INTENTS.map((i) => (
            <div key={i.id} class="voicenav-help-row">
              <span class="voicenav-help-phrase">"{i.phrases[0]}"</span>
            </div>
          ))}
          {META_INTENTS.map((i) => (
            <div key={i.id} class="voicenav-help-row">
              <span class="voicenav-help-phrase">"{i.phrases[0]}"</span>
            </div>
          ))}
          <div class="voicenav-help-close" onClick={() => setShowHelp(false)}>close</div>
        </div>
      )}
      {active && (heard || acted) && (
        <div class="voicenav-readout">
          {heard && <div class="voicenav-heard">{heard}</div>}
          {acted && <div class="voicenav-acted">{acted}</div>}
          {!acted && noMatch && <div class="voicenav-nomatch">no command matched</div>}
        </div>
      )}
      <div
        className={"voicenav-toggle " + (active ? "voicenav-toggle-on" : "")}
        onClick={toggle}
        title={active ? "Voice navigation on — click to turn off" : "Turn on voice navigation"}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(); }}
      >
        {active ? "Voice on" : "Voice off"}
      </div>
    </div>
  );
}

export default VoiceNav;
