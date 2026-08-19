import { useState, useEffect, useRef, useCallback } from "react";
import { useRecoilState } from "recoil";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import { SCREEN } from "../store";
import { NAV_INTENTS, META_INTENTS, CONFIRM_YES, CONFIRM_NO, matchIntent, matchTiered, isNavAllowed } from "./intents";
import { getRegisteredIntents } from "./registry";
import { getScreenControls } from "./domControls";
import "../styles/VoiceNav.css";

const STORAGE_KEY = 'earudite_voice_nav_enabled';

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
function VoiceNav() {
  const [screen, setScreen] = useRecoilState(SCREEN);
  const [enabled, setEnabled] = useState(loadEnabled);
  const [heard, setHeard] = useState('');
  const [acted, setActed] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [pending, setPending] = useState(null);   // destructive intent awaiting "yes"
  const [noMatch, setNoMatch] = useState(false);
  const lastActionAtRef = useRef(0);

  const { transcript, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();

  const allowed = isNavAllowed(screen);
  const active = enabled && allowed && browserSupportsSpeechRecognition;

  useEffect(() => {
    if (active) {
      resetTranscript();
      SpeechRecognition.startListening({ continuous: true, interimResults: true });
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
      // Several controls share this label — tell the user how to pick instead of guessing.
      setActed('Which one? say "' + intent.label + ' one" … "' + intent.label + ' ' +
        ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][Math.min(intent.count, 8) - 1] + '"');
      setShowHelp(true);
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

    // While a destructive command waits on confirmation, ONLY yes/no is listened for. Anything
    // else is ignored rather than executed, so a stray phrase can't quit your lobby.
    // Otherwise match in tiers (see matchTiered): explicit navigation, then screen-registered
    // commands, then visible controls, and only then bare destination names.
    const match = pending
      ? matchIntent(transcript, [CONFIRM_YES, CONFIRM_NO])
      : matchTiered(transcript, getRegisteredIntents(), getScreenControls());

    if (!match) {
      // Say so, rather than failing silently. A command that matches nothing used to look
      // identical to one the recognizer never heard, which made every failure undiagnosable —
      // including from the user's side. Showing the tail we tried to match tells you whether the
      // problem is recognition (wrong words) or matching (right words, no command).
      setNoMatch(true);
      return;
    }
    setNoMatch(false);

    // Debounce: interim results re-fire the same tail repeatedly as the recognizer refines it.
    const now = Date.now();
    if (now - lastActionAtRef.current < 1500) return;
    lastActionAtRef.current = now;

    const intent = match.intent;
    resetTranscript();

    if (pending) {
      const confirmed = intent.id === 'confirm.yes';
      const target = pending;
      setPending(null);
      if (confirmed) runIntent(target);
      else setActed('Cancelled');
      return;
    }

    // Destructive actions (quitting a lobby, leaving a game) ask first. A misheard "quit" that
    // fires immediately is the worst failure this feature can have.
    if (intent.confirm) {
      setPending(intent);
      setActed('Say "yes" to ' + intent.label.toLowerCase());
      return;
    }

    runIntent(intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, active, pending, runIntent]);

  // Drop a dangling confirmation if the screen changes out from under it.
  useEffect(() => { setPending(null); }, [screen]);

  // Clear the transient readout so a stale "heard" line doesn't linger between screens.
  useEffect(() => {
    setHeard('');
    setActed('');
    setNoMatch(false);
  }, [screen]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    saveEnabled(next);
    if (!next) setShowHelp(false);
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
