import { useEffect, useState } from "react";
import { useSpeechRecognition } from "react-speech-recognition";
import { micStatus, watchMic } from "./micOwner";
import "../styles/VoiceDebug.css";

const STORAGE_KEY = 'earudite_voice_debug_visible';

function loadVisible() {
  try { return window.localStorage.getItem(STORAGE_KEY) !== '0'; } catch (e) { return true; }
}

// Live readout of the shared speech recognizer, pinned to the bottom corner.
//
// Mounted app-wide, next to VoiceNav, so it spans the screen change into a game — which is exactly
// where the interesting failure was: the recognizer being running on one screen and stopped on the
// next looked identical from the inside, because nothing ever showed whether it was listening or
// who had claimed it.
//
// It shows three things, and they answer three different questions:
//   listening — is the recognizer actually running at all?
//   owner     — which component asked for it (voicenav / answerbox / nobody)?
//   heard     — what is it transcribing right now?
//
// A wake word that is heard but rejected, a recognizer that was aborted by someone else, and a
// microphone that is picking up nothing are three completely different bugs that used to look the
// same. Sibling of the router like VoiceNav, so its per-word re-renders never cascade into
// Game/AnswerBox and their main-thread audio callback.
function VoiceDebug() {
  const { transcript, browserSupportsSpeechRecognition } = useSpeechRecognition();
  const [status, setStatus] = useState(micStatus);
  const [visible, setVisible] = useState(loadVisible);

  useEffect(() => watchMic(() => setStatus(micStatus())), []);

  function hide() {
    setVisible(false);
    try { window.localStorage.setItem(STORAGE_KEY, '0'); } catch (e) { /* private mode */ }
  }

  if (!visible) return null;

  const owner = status.owners.length ? status.owners.join(' + ') : 'nobody';
  const tail = transcript ? transcript.split(' ').slice(-8).join(' ') : '';

  return (
    <div className="voicedebug-wrapper">
      <div className="voicedebug-row">
        <span className={"voicedebug-dot " + (status.listening ? "voicedebug-dot-on" : "")}></span>
        <span className="voicedebug-label">
          {!browserSupportsSpeechRecognition
            ? 'no Web Speech in this browser'
            : (status.listening ? 'listening' : 'not listening')}
        </span>
        <span className="voicedebug-owner">{owner}</span>
        <span className="voicedebug-close" onClick={hide} title="Hide (localStorage)">×</span>
      </div>
      <div className="voicedebug-heard">{tail || <i>nothing yet</i>}</div>
    </div>
  );
}

export default VoiceDebug;
