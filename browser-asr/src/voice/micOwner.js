import SpeechRecognition from "react-speech-recognition";

// Arbiter for the ONE Web Speech recognizer the whole app shares.
//
// react-speech-recognition exposes a singleton: every useSpeechRecognition() subscriber reads the
// same recognizer, and any caller's abortListening() stops it for everybody. That is what broke
// the in-game buzz. VoiceNav is mounted at the app root (index.tsx) and never unmounts, so on the
// game screen — where voice NAVIGATION is deliberately disallowed — its effect took the `else`
// branch and called abortListening(). AnswerBox had just started the same recognizer for the wake
// word, so whichever effect ran last decided, and the game usually lost. VoiceNav kept working
// everywhere else because there it is the only consumer.
//
// So consumers no longer start and stop the recognizer directly. They register interest, and this
// module runs it while at least one of them wants it. A screen where one consumer hands over to
// another (leaving the lobby for a game) never stops listening at all.
const claims = new Set();
const watchers = new Set();
let listening = false;
let flushQueued = false;

function apply() {
  const want = claims.size > 0;
  if (want === listening) { notify(); return; }
  listening = want;
  try {
    if (want) SpeechRecognition.startListening({ continuous: true });
    else SpeechRecognition.abortListening();
  } catch (e) {
    // A recognizer that refuses to start is reported through the status, not thrown at the caller.
    listening = false;
  }
  notify();
}

// Coalesce to a microtask so a hand-off within one React commit — one consumer releasing while
// another claims — does not abort and immediately restart, which would drop whatever was being
// said across the gap.
function sync() {
  if (flushQueued) return;
  flushQueued = true;
  Promise.resolve().then(() => { flushQueued = false; apply(); });
}

function notify() {
  watchers.forEach((fn) => { try { fn(); } catch (e) { /* a bad watcher must not break others */ } });
}

export function claimMic(owner) { claims.add(owner); sync(); }
export function releaseMic(owner) { claims.delete(owner); sync(); }

// For the debug overlay: who wants the mic, and is it actually running.
export function micStatus() {
  return { owners: Array.from(claims), listening: listening };
}

export function watchMic(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
