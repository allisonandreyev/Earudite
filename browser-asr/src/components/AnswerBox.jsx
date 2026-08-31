import { useState, useEffect, useLayoutEffect, useRef } from "react";
import MicOffIcon from "@material-ui/icons/MicOff";
import { useRecoilValue } from "recoil";
import { PROFILE, SOCKET } from "../store";
import { useAlert } from "react-alert";
import { ProgressBar } from "react-bootstrap";
import * as localWhisper from "../asr/localWhisper";
import { useSpeechRecognition } from "react-speech-recognition";
import { claimMic, releaseMic } from "../voice/micOwner";
import LegacyVoiceAnswering from "./LegacyVoiceAnswering.jsx";
import "../pkg/StackedProgressBar.css";
import "../styles/AnswerBox.css";

function useKeyPress(targetKey, fnCall, deps, condition) {
  const [keyPressed, setKeyPressed] = useState(false);
  function downHandler({ key }) {
    if (key === targetKey) {
      setKeyPressed(true);
    }
  }
  const upHandler = ({ key }) => {
    if ((key === targetKey) && condition) {
      fnCall();
      setKeyPressed(false);
    }
  };
  useEffect(() => {
    window.addEventListener("keydown", downHandler);
    window.addEventListener("keyup", upHandler);
    return () => {
      window.removeEventListener("keydown", downHandler);
      window.removeEventListener("keyup", upHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
  return keyPressed;
}

function VoiceButtonVolume(props) {
  const volumeRange = [20,80];
  return (
    <div class="answerbox-voicebutton-volume-wrapper">
      <div class="answerbox-voicebutton-volume-slider" style={{"height":((Math.min(Math.max(volumeRange[0],props.volume),volumeRange[1])-volumeRange[0])/(volumeRange[1]-volumeRange[0])*0.3+0.4).toString()+"rem"}}></div>
      <div class="answerbox-voicebutton-volume-slider" style={{"height":((Math.min(Math.max(volumeRange[0],props.volume),volumeRange[1])-volumeRange[0])/(volumeRange[1]-volumeRange[0])*1.1+0.4).toString()+"rem"}}></div>
      <div class="answerbox-voicebutton-volume-slider" style={{"height":((Math.min(Math.max(volumeRange[0],props.volume),volumeRange[1])-volumeRange[0])/(volumeRange[1]-volumeRange[0])*0.3+0.4).toString()+"rem"}}></div>
    </div>
  )
}

function VoiceButton(props) {

  function handleChange() {
    if(props.canClassify) props.setMode(m => ((m+1)%3));
    else props.setMode(m => ((m+1)%2));
  }

  if(props.mode === 0) {
    return (
      <div class="answerbox-voicebutton-wrapper answerbox-hvr-grow" onClick={handleChange}>
        <MicOffIcon
          style={{
            color: "white",
            width: "60%",
            height: "60%",
          }}
        />
      </div>
    )
  } else if(props.mode === 1) {
    return (
      <div class="answerbox-voicebutton-wrapper answerbox-hvr-grow" style={{"background-color":"#6287F6"}} onClick={handleChange}>
        <VoiceButtonVolume volume={props.volume}/>
      </div>
    )
  } else {
    return (
      <div class="answerbox-voicebutton-wrapper answerbox-hvr-grow" style={{"background-color":"#90E99C"}} onClick={handleChange}>
        <VoiceButtonVolume volume={props.volume}/>
      </div>
    )
  }

}

function downsampleTo16k(buffer, fromRate) {
  if (fromRate === 16000) return new Float32Array(buffer);
  const ratio = fromRate / 16000;
  const out = new Float32Array(Math.round(buffer.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = buffer[Math.round(i * ratio)];
  return out;
}

// Local-transcription tuning — mirrors the tuning the server used to apply when it ran
// faster_whisper on this same stream.
const STREAM_SAMPLE_RATE = 16000;
const MIN_STREAM_SAMPLES = 0.5 * STREAM_SAMPLE_RATE;  // start after 0.5s of audio
const MAX_PARTIAL_SAMPLES = 10 * STREAM_SAMPLE_RATE;  // cap the transcribed window at 10s
const STREAM_INTERVAL_MS = 500;                       // throttle between local transcriptions

// Window transcribed while WAITING to buzz, as opposed to the full 10s used once buzzed in.
//
// The wake word is one short token. Handing whisper the whole 10s buffer meant that token sat
// inside ten seconds of whatever else the mic picked up — and since every question is now an audio
// clip playing through the speakers, that is ten seconds of music leaking past echo cancellation.
// Whisper transcribes the lot, the wake word lands somewhere in the middle of it, and the
// short trailing-word check never sees it. Detection "worked" in a quiet room and failed in a
// real game, which is exactly the reported behaviour.
//
// A short tail fixes it at the source: over ~2.5s a shouted "buzz" IS most of the audio, so it
// dominates the transcript instead of being buried in it. Inference cost is unchanged — whisper
// pads every input to 30s regardless — so this is purely a signal-to-noise improvement.
const WAKE_WINDOW_SAMPLES = 2.5 * STREAM_SAMPLE_RATE;

// "buzz" wake-word matching.
//
// The old rule was an exact /^buzz[.!?]?$/ on the last 3 words. Measured against whisper-tiny.en
// transcribing a shouted "buzz" across 17 macOS voices x 4 acoustic conditions, that exact match
// caught only 36/68 — it silently dropped nearly half of real buzzes AFTER paying the ~1.1s
// inference cost. Whisper rarely renders a lone shouted "buzz" cleanly, especially with echo
// cancellation stripping the surrounding speech context; "bus" and "buss" are common outputs.
//
// This list is every token whisper-tiny.en actually produced for a real "buzz" in that sweep. It
// scores 63/68 (93%) with ZERO false positives on silence (60 trials) and on question audio
// (19 rolling windows). Deliberately excluded: "thus", "us" and "was" — they would add ~4 points
// of recall but fire on ordinary quiz-bowl prose leaking in through the speakers.
//
// Note this is the OPPOSITE bias to SUBMIT matching elsewhere: a false buzz only buzzes you in
// early, so over-triggering is the cheaper error here.
const BUZZ_TOKENS = new Set([
  'buzz', 'buzzed', 'buzzes', 'buzzer', 'buzzy',
  'buss', 'busses', 'bus', 'bos', 'boss',
  'fuzz', 'fuzzed', 'bub', 'buh', 'bud',
  'buns', 'bun', 'bubble', 'bass', 'baz', 'fast',
]);
// Upper bound on how much of a wake-window transcript is scanned. The window is short enough that
// this is rarely reached; it only guards against whisper hallucinating a long run on noise.
const BUZZ_SCAN_WORDS = 8;
const BUZZ_COOLDOWN_MS = 2000;

// Wake-word tokens for the Web Speech recognizer (see the wake-word effect below).
//
// Much tighter than BUZZ_TOKENS. That list is an accept-list of everything whisper-tiny.en
// MANGLES a shouted "buzz" into, and it has to be permissive because whisper is bad at short
// isolated words. Web Speech is not: it returns "buzz" as "buzz". Reusing the loose list here
// would only invite false buzzes on question audio leaking through the speakers, since these are
// ordinary English words.
const WEB_SPEECH_BUZZ_TOKENS = new Set([
  'buzz', 'buzzed', 'buzzer', 'buzzes', 'buzzing', 'buss',
]);
// Only the last couple of words count, so a wake word has to be recent rather than anywhere in a
// continuously growing transcript.
const WEB_SPEECH_TAIL_WORDS = 3;

// Set window.EARUDITE_VOICE_DEBUG = true in the console to trace what whisper heard and why a
// keyword did or did not fire. Off by default so a normal game logs nothing.
//
// Read live, not captured at module load. As a `const` evaluated when the bundle first ran, the
// flag could only ever be false — the console does not exist to type into until long after that —
// so the one tool for diagnosing voice problems could not actually be switched on.
function voiceDebug() {
  return typeof window !== 'undefined' && !!window.EARUDITE_VOICE_DEBUG;
}

// "submit" keyword matching — same method as BUZZ_TOKENS above (accept-list built from measured
// whisper-tiny.en output), but with two deliberate differences.
//
// 1. END-ANCHORED. Only the last SUBMIT_TAIL_TOKENS tokens count. The old rule tested
//    /\bsubmit\b/ anywhere in the transcript and stripped every occurrence, so an answer that
//    merely contained the word would send itself and arrive mangled.
// 2. CONSERVATIVE, where the buzz list is permissive. A false buzz just buzzes you in early; a
//    false submit sends an unfinished answer and loses the question. So here a missed keyword is
//    the cheaper error — you can always press Enter.
//
// Measured over 192 trials ("<answer> submit", 8 voices x 4 conditions): whisper emitted `submit`
// 161 times plus the near-misses below. This list scores 87% recall with 0 false positives across
// 364 negatives. `mid` (11 misses), `admit` (3), `met` (2) and `myth` (3) would raise recall to
// 98% and show zero false positives against ordinary answers — which is the trap. Against answers
// that genuinely END in those words ("the mid-Atlantic ridge", "the Sisyphus myth", "they finally
// met"), `mid` alone submits 22/108 of them and all four together submit 77/108.
const SUBMIT_TOKENS = new Set([
  'submit', 'submits', 'submitted', 'submitting',
  'sumit', 'submid', 'submitt', 'supmit',
]);
const SUBMIT_TAIL_TOKENS = 2;

// Voice-activity gate. Without it the pipeline transcribes pure silence continuously, which pegs
// a core for the whole question (whisper's encoder cost is flat regardless of content) and invites
// its well-known silence hallucinations. Gating means a real utterance finds the worker free and
// starts inference immediately instead of queueing behind a pointless pass.
//
// This is ADAPTIVE rather than a fixed threshold. The first version used a fixed RMS of 0.012,
// which was far too high — ordinary speech sits around 0.01-0.1 depending on mic gain and
// distance, so anything softly spoken fell below the gate, was never transcribed at all, and the
// keyword inside it could never be detected. That cost recall on both "buzz" and "submit".
//
// Instead: track the ambient noise floor and treat anything clearly above it as speech. The gate
// only has to reject dead air — a false "speech" reading merely spends an inference pass, which
// is what the code did unconditionally before, so it is much better to be permissive here.
const VAD_MIN_RMS = 0.0035;         // absolute floor; below this it is digital silence
const VAD_NOISE_MULTIPLIER = 2.2;   // how far above ambient counts as speech
// Keep treating the mic as active this long after speech stops.
//
// This was 700ms, which is SHORTER than a whisper pass (~1.1s), and that single fact is why a
// spoken "submit" so often did nothing: a pass would be in flight over audio recorded before the
// word, the hangover would expire while it ran, and when the worker freed up the gate was already
// closed — so the audio containing "submit" was captured, buffered, and never transcribed.
// Simulated over realistic answer lengths, that lost the final word 42% of the time.
// Raising this above the inference cost drops it to 0. The trailing-pass gate in the audio
// callback covers the case where inference is slower still (a busy or slower machine).
const VAD_HANGOVER_MS = 1400;
const VAD_FLOOR_ATTACK = 0.05;      // how fast the ambient estimate tracks upward

function emptyPcm() {
  return new Float32Array(0);
}

// Whisper annotates non-speech audio instead of returning nothing, so silence comes back as
// markers like "[BLANK_AUDIO]", "(water splashing)", "[wind blowing]" or "*sigh*". Measured on
// 60 silence/room-tone trials, whisper-tiny.en emitted [BLANK_AUDIO] 40 times. Those strings were
// landing in the answer box as if the player had said them.
//
// Strip every bracketed/parenthesised/asterisked annotation. If nothing but annotation was
// returned this yields '', and applyLocalTranscription's early return then leaves the previous
// good text alone rather than blanking the box — important because each pass re-transcribes the
// whole rolling buffer and overwrites the field wholesale.
function stripNonSpeech(text) {
  if (!text) return '';
  return text
    .replace(/\[[^\]]*\]/g, ' ')   // [BLANK_AUDIO], [wind blowing], [MUSIC]
    .replace(/\([^)]*\)/g, ' ')    // (water splashing), (upbeat music)
    .replace(/\*[^*]*\*/g, ' ')    // *sigh*
    .replace(/\s+/g, ' ')
    .trim();
}

function AnswerBox(props) {
  const profile = useRecoilValue(PROFILE);
  const username = profile["username"];
  const alert = useAlert();
  const socket = useRecoilValue(SOCKET);
  const [speechMode, setSpeechMode] = useState(2);
  const speechModeRef = useRef(2);

  const socketRef = useRef(socket);
  // Read from the audio callback, which is created once and cannot see later renders' values.
  const webSpeechRef = useRef(false);
  const alertRef = useRef(alert);
  const usernameRef = useRef(username);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { alertRef.current = alert; }, [alert]);
  useEffect(() => { usernameRef.current = username; }, [username]);

  const lastBuzzDetectRef = useRef(0);

  // Local (in-browser) Whisper transcription scratch buffer — separate from the PCM stream sent
  // to the server, which is storage-only now (the raw answer recording still needs to reach the
  // backend as labeled training data; only the transcription itself moved client-side).
  const localBufferRef = useRef(emptyPcm());
  const lastLocalTranscribeRef = useRef(0);
  // Bumped every time the buffer is discarded. A transcription pass runs against a COPY of the
  // buffer and takes ~1.1s, so a pass started before a reset would otherwise land afterwards and
  // be applied as if it were current. That is what put the pre-buzz audio — "buzz buzz buzz" —
  // into the answer box the moment you clicked Buzz.
  const transcribeEpochRef = useRef(0);
  const lastVoiceAtRef = useRef(0);       // last time input RMS looked like speech
  // Wall-clock time the most recent pass's audio reached. Compared against lastVoiceAtRef to tell
  // whether any speech has happened that no pass has covered yet — see the trailing-pass gate.
  const passCoversUpToRef = useRef(0);
  const noiseFloorRef = useRef(0.002);    // running estimate of ambient level (see VAD_ constants)

  const audioStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const processorRef = useRef(null);
  const buzzerRef = useRef(props.buzzer);
  const answerRef = useRef(props.answer);
  const actionRef = useRef({});

  // WAKE WORD: Web Speech, not whisper.
  //
  // Measured on this machine, one whisper-tiny.en pass costs 4.1-4.9s warm and 9.8s on the first
  // call of a page load (26.8s with a cold HTTP cache) — not the ~1.07s the constants above were
  // written against. The page is not cross-origin isolated (server/server.js explains why COOP was
  // reverted: it broke Google sign-in), so ORT runs single-threaded and that is the real cost.
  //
  // At 4.5s a pass, whisper cannot do a wake word at all. Passes are serialised by
  // isTranscribing(), so one starts roughly every 4.5s and looks at the last 2.5s of audio —
  // leaving ~2s of every 4.5s that NO pass ever examines. A "buzz" landing in one of those gaps is
  // not heard late, it is never heard. Add the ~10s of dead air while the model compiles at the
  // start of a game and "it never responds" is exactly right.
  //
  // Web Speech has none of that cost and is already proven on this word by the voice-nav bar. It
  // runs its own browser-managed capture, independent of our getUserMedia stream (see the note in
  // LegacyVoiceAnswering.jsx), so it does not fight the recorder for the microphone.
  //
  // Scope is deliberately narrow: it listens only while waiting to buzz, and is aborted the moment
  // a buzz lands. Answer transcription stays entirely on local whisper, where a multi-second pass
  // is affordable against a 15s answer window and the audio never leaves the machine.
  const {
    transcript: wakeTranscript,
    resetTranscript: resetWakeTranscript,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition();

  // The live transcript readout lives in VoiceDebug (bottom-left, app-wide) rather than here, so
  // it survives the screen change into a game and shows who owns the recognizer as well.
  const [asrError, setAsrError] = useState('');
  useEffect(() => { buzzerRef.current = props.buzzer; }, [props.buzzer]);
  useEffect(() => { answerRef.current = props.answer; }, [props.answer]);

  function complete(answer) {
    props.setAnswer(answer.substr(answer.indexOf(" ") + 1).replace("stop", ""));
  }

  function setAnswer2(event) {
    props.setAnswer(event.target.value);
  }

  const textAnswer = useRef(null);

  // Discard the rolling buffer and invalidate any transcription already in flight over it.
  function resetLocalBuffer() {
    localBufferRef.current = emptyPcm();
    transcribeEpochRef.current += 1;
    // The discarded audio is no longer owed a pass.
    passCoversUpToRef.current = Date.now();
  }

  function buzzin() {
    props.buzz();
    setTimeout(()=>{ if (textAnswer.current) textAnswer.current.focus(); }, 100);
  }

  function submit1(textOverride) {
    const answer = textOverride !== undefined ? textOverride : props.answer;
    // Discard the audio this answer was transcribed from, on EVERY submit path.
    //
    // Only the spoken-"submit" path used to do this. Clicking Submit (or pressing Enter) left the
    // rolling buffer intact, so the next pass re-transcribed the same speech and called
    // setAnswer() again — repopulating the box that submit had just cleared. It looks exactly
    // like the submit was ignored, and a second click then gets rejected server-side because the
    // first one already ended the buzz.
    resetLocalBuffer();
    lastLocalTranscribeRef.current = Date.now();
    if (socketRef.current) socketRef.current.emit('reset_audio_stream', {});
    props.submit(answer);
    props.setAnswer("");
  }

  // Detect the spoken "submit" keyword at the end of an answer and strip it plus anything after
  // it. See SUBMIT_TOKENS for why this is end-anchored and why the list is short.
  function processTranscription(text) {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { cleaned: '', hasSubmit: false };
    const from = Math.max(0, tokens.length - SUBMIT_TAIL_TOKENS);
    for (let i = from; i < tokens.length; i++) {
      const w = tokens[i].toLowerCase().replace(/[^a-z']/g, '');
      if (SUBMIT_TOKENS.has(w)) {
        return { cleaned: tokens.slice(0, i).join(' ').trim(), hasSubmit: true };
      }
    }
    return { cleaned: tokens.join(' ').trim(), hasSubmit: false };
  }

  actionRef.current.buzzin = buzzin;
  actionRef.current.submit1 = submit1;

  // After each Whisper answer update, scroll the input to show the newest text
  // and move the cursor to the end. useLayoutEffect runs after the DOM is updated
  // but before the browser paints, so scrollLeft is set on the correct layout.
  useLayoutEffect(() => {
    const el = textAnswer.current;
    if (!el || props.buzzer !== username) return;
    el.scrollLeft = el.scrollWidth;
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
  }, [props.answer, props.buzzer, username]);

  // On question change: reset server buffer and ASR state
  useEffect(() => {
    resetLocalBuffer();
    if (speechModeRef.current === 2) {
      socketRef.current.emit('reset_audio_stream', {});
    } else if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
      socketRef.current.emit('stop_audio_stream', {});
    }
    // eslint-disable-next-line
  }, [props.question]);

  // Sync speechMode into ref
  useEffect(()=> {
    speechModeRef.current = speechMode;

    // Start or stop the PCM stream based on mode
    if (speechMode === 2) {
      if (audioContextRef.current && audioSourceRef.current && !processorRef.current) {
        startPCMStream();
      }
    } else {
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
        socketRef.current.emit('stop_audio_stream', {});
        resetLocalBuffer();
      }
    }
    // eslint-disable-next-line
  },[speechMode]);

  useEffect(() => {
    if (props.buzzer !== "" && props.buzzer !== username) props.setAnswer("");
    // eslint-disable-next-line
  }, [props.buzzer, username])

  useEffect(()=> {
    localWhisper.warmup();
    // eslint-disable-next-line
  },[]);

  // In Whisper mode: reset the local buffer on buzz-in so answer transcription starts fresh;
  // on buzz-out, run one last local transcription over what was buffered, then restart for
  // keyword detection. The server-side stream is storage-only now (see main.py) but still
  // needs its own reset/stop/start so the raw recording keeps landing in the training data set.
  useEffect(() => {
    if (speechMode !== 2) return;
    if (props.buzzer === username) {
      // Buzzing in starts a fresh answer: nothing captured before this moment belongs in the
      // answer box, including the spoken "buzz" itself.
      resetLocalBuffer();
      socketRef.current.emit('reset_audio_stream', {});
    } else {
      if (localBufferRef.current.length >= MIN_STREAM_SAMPLES) {
        runLocalTranscription(localBufferRef.current, true);
      }
      resetLocalBuffer();
      socketRef.current.emit('stop_audio_stream', {});
      socketRef.current.emit('start_audio_stream', {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.buzzer, username, speechMode]);

  // Apply a locally-transcribed chunk: update the answer box when buzzed in, detect the "buzz"
  // keyword otherwise. Mirrors the old partial_transcription/final_transcription socket handlers.
  function applyLocalTranscription(text, isFinal) {
    if (!text) return;
    // The truthiness check matters: buzzerRef is '' when nobody has buzzed, so if the profile
    // has not loaded yet and usernameRef is also '', this comparison was true and every pass
    // took the answer branch — writing speech into the box while making the "buzz" wake word
    // permanently undetectable.
    if (buzzerRef.current && buzzerRef.current === usernameRef.current) {
      const { cleaned, hasSubmit } = processTranscription(text);
      if (voiceDebug()) console.log('[voice] answer pass', JSON.stringify(text), '| submit:', hasSubmit);
      props.setAnswer(cleaned);
      if (hasSubmit) {
        // submit1() clears the buffer for every path now, so the spoken route just calls it.
        actionRef.current.submit1(cleaned);
      }
    } else if (!isFinal && !buzzerRef.current) {
      // These passes now cover only the last WAKE_WINDOW_SAMPLES of audio, so the entire
      // transcript is by definition recent — a few words at most. Scan all of it rather than a
      // fixed tail: whisper regularly renders a shouted "buzz" with a leading filler it invented
      // ("uh, buzz", "the buzz"), which pushed the real token out of a 3-word tail even when the
      // window was short. Over-triggering is the cheap error here (it just buzzes you in early),
      // which is the same reasoning behind BUZZ_TOKENS being permissive.
      const words = text.trim().toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
      const scanned = words.length > BUZZ_SCAN_WORDS ? words.slice(-BUZZ_SCAN_WORDS) : words;
      const now = Date.now();
      const hit = scanned.find(w => BUZZ_TOKENS.has(w));
      if (hit && now - lastBuzzDetectRef.current > BUZZ_COOLDOWN_MS) {
        if (voiceDebug()) console.log('[voice] BUZZ on', JSON.stringify(hit), 'from', JSON.stringify(text));
        lastBuzzDetectRef.current = now;
        resetLocalBuffer();
        socketRef.current.emit('reset_audio_stream', {});
        actionRef.current.buzzin();
      } else if (voiceDebug() && text) {
        console.log('[voice] no buzz in', JSON.stringify(text), '| scanned:', scanned);
      }
    }
  }

  async function runLocalTranscription(pcm, isFinal) {
    const epoch = transcribeEpochRef.current;
    const text = stripNonSpeech(await localWhisper.transcribe(pcm));
    // The buffer was thrown away while this pass was running (buzz-in, submit, new question),
    // so `text` describes audio that no longer applies. Dropping it here is what stops stale
    // pre-buzz speech from being written into the answer box.
    //
    // Only partials are dropped. The buzz-out flush is deliberately a final pass over a buffer
    // that is being torn down in the same tick, so it would always look stale.
    if (!isFinal && transcribeEpochRef.current !== epoch) return;
    applyLocalTranscription(text, isFinal);
  }

  // ONE recognizer for the whole voice flow: the wake word AND the spoken answer.
  //
  // Answering used to run on local whisper, and whisper is simply too slow to do it here — a warm
  // pass measures 4-5s on this (un-isolated, single-threaded) page, so an answer appeared seconds
  // after it was spoken and a trailing "submit" routinely missed the buzz window entirely. Web
  // Speech is the recognizer already proven on this app, in the voice-nav bar: it streams
  // interim results continuously, so the answer box fills in as you speak and "submit" fires the
  // moment you say it.
  //
  // Same shape as VoiceNav: start on mount, listen continuously, read the tail of the transcript,
  // reset after acting. The only thing that changes between the two phases is what the tail is
  // scanned for — a wake word before a buzz, a submit keyword after one.
  //
  // Note the raw microphone audio still streams to the backend as labelled training data exactly
  // as before (see the 'audio_chunk' emit in startPCMStream); that path is untouched by this.
  const voiceOn = speechMode === 2 && !!browserSupportsSpeechRecognition;
  const buzzedInByMe = !!props.buzzer && props.buzzer === username;
  webSpeechRef.current = voiceOn;

  useEffect(() => {
    if (voiceOn) {
      resetWakeTranscript();
      claimMic('answerbox');
    } else {
      // Released rather than merely ignored: on Chrome this audio goes to Google's servers, so
      // once the player switches the mic off nothing here should keep it open. micOwner stops the
      // recognizer as soon as no one is claiming it.
      releaseMic('answerbox');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn]);

  useEffect(() => () => { releaseMic('answerbox'); }, []);

  // Clear the transcript on every buzz transition, so the wake word itself is never treated as the
  // first word of the answer, and a previous answer never bleeds into the next buzz.
  useEffect(() => {
    resetWakeTranscript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.buzzer, props.question]);

  useEffect(() => {
    if (!voiceOn || !wakeTranscript) return;

    if (buzzedInByMe) {
      // Buzzed in: the transcript IS the answer. Interim results mean this updates as you talk.
      const { cleaned, hasSubmit } = processTranscription(wakeTranscript);
      if (voiceDebug()) console.log('[voice] answer', JSON.stringify(wakeTranscript), '| submit:', hasSubmit);
      props.setAnswer(cleaned);
      if (hasSubmit) {
        // Reset first: submit1() clears the answer box, and a transcript still holding "…submit"
        // would immediately refill it and fire again on the next interim result.
        resetWakeTranscript();
        actionRef.current.submit1(cleaned);
      }
      return;
    }

    if (props.buzzer) return;   // someone else has it; nothing to listen for

    const words = wakeTranscript.trim().toLowerCase()
      .replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
    const recent = words.slice(-WEB_SPEECH_TAIL_WORDS);
    const hit = recent.find((w) => WEB_SPEECH_BUZZ_TOKENS.has(w));
    const now = Date.now();
    if (hit && now - lastBuzzDetectRef.current > BUZZ_COOLDOWN_MS) {
      if (voiceDebug()) console.log('[voice] BUZZ (web speech) on', JSON.stringify(hit));
      lastBuzzDetectRef.current = now;
      resetWakeTranscript();
      // Nothing said before the buzz belongs in the answer box.
      resetLocalBuffer();
      socketRef.current.emit('reset_audio_stream', {});
      actionRef.current.buzzin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeTranscript, voiceOn, buzzedInByMe, props.buzzer]);

  // Surface a recogniser failure rather than letting it look like the mic simply isn't hearing
  // you. localWhisper recovers on its own now (it rebuilds the worker), so this clears itself.
  useEffect(() => {
    if (speechMode !== 2) { setAsrError(''); return; }
    const t = setInterval(() => setAsrError(localWhisper.getLastError()), 1000);
    return () => clearInterval(t);
  }, [speechMode]);

  useKeyPress("Enter", submit1, [props.answer], true);
  useKeyPress(" ", buzzin, [], document.activeElement !== textAnswer.current);

  const [volume, setVolume] = useState(0);

  function startPCMStream() {
    const ctx = audioContextRef.current;
    socketRef.current.emit('start_audio_stream', {});
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const pcm = downsampleTo16k(e.inputBuffer.getChannelData(0), ctx.sampleRate);
      socketRef.current.emit('audio_chunk', pcm.buffer);

      const merged = new Float32Array(localBufferRef.current.length + pcm.length);
      merged.set(localBufferRef.current);
      merged.set(pcm, localBufferRef.current.length);
      // The rolling buffer has to hold everything the next pass might need. Pre-buzz that is now
      // "whatever accumulated since the last pass started" rather than a fixed 2.5s (see wakeSpan
      // below), and post-buzz it is the whole answer, so both cases want the same 10s cap.
      const keep = MAX_PARTIAL_SAMPLES;
      localBufferRef.current = merged.length > keep
        ? merged.slice(merged.length - keep)
        : merged;

      const now = Date.now();

      // Voice-activity gate: only spend an inference pass when something was actually said
      // recently. RMS over this 85ms chunk, compared against a running estimate of the room's
      // ambient level so it adapts to mic gain instead of assuming one.
      let sumSquares = 0;
      for (let i = 0; i < pcm.length; i++) sumSquares += pcm[i] * pcm[i];
      const rms = pcm.length ? Math.sqrt(sumSquares / pcm.length) : 0;

      const speechThreshold = Math.max(VAD_MIN_RMS, noiseFloorRef.current * VAD_NOISE_MULTIPLIER);
      if (rms >= speechThreshold) {
        lastVoiceAtRef.current = now;
      } else {
        // Only let quiet chunks teach the noise floor, so sustained speech can't drag the
        // threshold up behind itself and gate out the rest of the sentence.
        noiseFloorRef.current += (rms - noiseFloorRef.current) * VAD_FLOOR_ATTACK;
      }
      const recentlyVoiced = now - lastVoiceAtRef.current < VAD_HANGOVER_MS;

      // Is there speech that no pass has transcribed yet? This is what makes the LAST utterance
      // reliably reach whisper.
      //
      // The gate used to be `recentlyVoiced` alone, and VAD_HANGOVER_MS (700ms) is shorter than a
      // whisper pass (~1.1s). Saying "<answer> submit" and stopping therefore went: a pass is
      // already in flight over audio that predates "submit"; the hangover expires while it runs;
      // by the time the worker frees up, recentlyVoiced is false, so no further pass ever starts.
      // The audio containing "submit" was captured, buffered — and never transcribed. Same for a
      // wake word spoken right before falling silent.
      //
      // Tracking how far the last pass reached fixes it precisely: exactly one trailing pass runs
      // after speech ends, and once it has covered that speech the condition goes false again.
      const hasUncoveredSpeech = lastVoiceAtRef.current > passCoversUpToRef.current;

      const buzzedIn = buzzerRef.current && buzzerRef.current === usernameRef.current;

      // How much audio the next pre-buzz pass must cover.
      //
      // A fixed 2.5s window silently assumed a pass costs about that much. Passes actually cost
      // 4-5s here, so consecutive windows did not touch: roughly 2s of every 4.5s was never looked
      // at by anything. Covering everything since the last pass started closes that gap, so
      // whisper remains a complete (if slow) backstop behind the Web Speech wake word above.
      const sinceLastPass = Math.ceil(((now - passCoversUpToRef.current) / 1000) * STREAM_SAMPLE_RATE);
      const wakeSpan = Math.min(
        MAX_PARTIAL_SAMPLES,
        Math.max(WAKE_WINDOW_SAMPLES, sinceLastPass)
      );

      // Waiting to buzz, passes run back-to-back; once buzzed in they stay throttled.
      //
      // STREAM_INTERVAL_MS exists so a long answer is not re-transcribed far more often than it
      // changes. Before a buzz there is no answer — the only thing being looked for is one wake
      // word, over a 2.5s window, and every millisecond between saying "buzz" and the pass that
      // spots it is latency the player feels directly. isTranscribing() already caps this at one
      // pass at a time (they cannot overlap), so the extra half-second on top bought nothing and
      // added up to 500ms to every voice buzz.
      const minInterval = buzzedIn ? STREAM_INTERVAL_MS : 0;

      if (
        // Only when Web Speech is unavailable. Where it works it handles both the wake word and
        // the answer, and running whisper as well would burn a core for the whole question on
        // passes nothing reads — and, post-buzz, would fight it for the answer box.
        !webSpeechRef.current &&
        (recentlyVoiced || hasUncoveredSpeech) &&
        localBufferRef.current.length >= MIN_STREAM_SAMPLES &&
        !localWhisper.isTranscribing() &&
        now - lastLocalTranscribeRef.current >= minInterval
      ) {
        lastLocalTranscribeRef.current = now;
        passCoversUpToRef.current = now;
        // Buzzed in: the whole buffer, because the answer may be a long sentence.
        // Waiting to buzz: only the recent tail, so the wake word is not buried (see
        // WAKE_WINDOW_SAMPLES).
        const buf = localBufferRef.current;
        const pass = buzzedIn || buf.length <= wakeSpan
          ? buf.slice()
          : buf.slice(buf.length - wakeSpan);
        runLocalTranscription(pass, false);
      }
    };
    audioSourceRef.current.connect(processor);
    processor.connect(ctx.destination);
    processorRef.current = processor;
  }

  const voiceActive = speechMode > 0;
  useEffect(() => {
    if (!voiceActive) return;

    let stream = null;
    let audioContext = null;
    let volumeInterval = null;

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
        audioStreamRef.current = stream;

        audioContext = new AudioContext();
        const audioSource = audioContext.createMediaStreamSource(stream);
        audioContextRef.current = audioContext;
        audioSourceRef.current = audioSource;

        // In Whisper mode, start PCM streaming immediately for keyword detection
        if (speechModeRef.current === 2) {
          startPCMStream();
        }

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.minDecibels = -127;
        analyser.maxDecibels = 0;
        analyser.smoothingTimeConstant = 0.4;
        audioSource.connect(analyser);
        const volumes = new Uint8Array(analyser.frequencyBinCount);
        volumeInterval = setInterval(() => {
          analyser.getByteFrequencyData(volumes);
          let volumeSum = 0;
          for (const v of volumes) volumeSum += v;
          setVolume(volumeSum / volumes.length);
        }, 100);
      } catch (e) {
        setSpeechMode(0);
        console.error("Microphone not detected: ", e);
        alertRef.current.error("Microphone: " + (e.name || e.message || "not detected"));
      }
    }

    init();

    return () => {
      if (volumeInterval) clearInterval(volumeInterval);
      if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
      socketRef.current.emit('stop_audio_stream', {});
      resetLocalBuffer();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioContext) audioContext.close();
      audioStreamRef.current = null;
      audioContextRef.current = null;
      audioSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive]);

  return (
    <div class="answerbox-answering-bigger-wrapper">
      <div class="answerbox-answering-wrapper">
        <input
          disabled={props.buzzer !== username}
          type="text"
          name="name"
          value={props.answer}
          onChange={setAnswer2}
          className={"answerbox-textbox-text"}
          ref={textAnswer}
          autocomplete="off"
        />
        <div class="answerbox-switch-wrapper">
          <VoiceButton mode={speechMode} setMode={setSpeechMode} volume={volume} canClassify={true}/>
        </div>

        <div class="answerbox-button" onClick={buzzin}>
          Buzz
        </div>
        <div class="answerbox-button" onClick={() => submit1()}>
          Submit
        </div>
      </div>
      {speechMode === 2 && props.buzzer === username &&
        <div className="answerbox-asr-progressbar-wrapper">
          <ProgressBar now={100} variant={"danger"} striped={true} animated={true} label="Listening..."/>
        </div>
      }
      {/* Mode 1 owns its own recognizer, progress bar and instructions. It is mounted only in
          mode 1 so that asr-answering's unconditional startListening() (see
          LegacyVoiceAnswering.jsx) cannot keep Web Speech open in mode 0 or mode 2. */}
      {speechMode === 1 &&
        <LegacyVoiceAnswering
          question={props.question}
          inGame={props.state.inGame}
          onComplete={complete}
          onSubmit={() => submit1()}
          onBuzzin={buzzin}
        />
      }
      {speechMode === 2 &&
        <div class="answerbox-answering-voice-instructions">
          Say <div class="answerbox-answering-voice-instructions-highlight">"buzz"</div> or click Buzz → speak → click
          <div class="answerbox-answering-voice-instructions-btn-highlight">Submit</div>
        </div>
      }
      {speechMode === 2 && asrError &&
        <div className="answerbox-voice-heard-error">
          Speech recognition problem: {asrError} — retrying
        </div>
      }
    </div>
  );
}

export default AnswerBox;
