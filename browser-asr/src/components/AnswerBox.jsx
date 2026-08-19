import { useState, useEffect, useLayoutEffect, useRef } from "react";
import MicOffIcon from "@material-ui/icons/MicOff";
import { useRecoilValue } from "recoil";
import { PROFILE, SOCKET } from "../store";
import { useAlert } from "react-alert";
import { ProgressBar } from "react-bootstrap";
import * as localWhisper from "../asr/localWhisper";
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
const BUZZ_TAIL_WORDS = 3;
const BUZZ_COOLDOWN_MS = 2000;

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
const VAD_HANGOVER_MS = 700;        // keep going this long after speech stops, so a trailing
                                    // keyword after a short pause is still captured
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
  const lastVoiceAtRef = useRef(0);       // last time input RMS looked like speech
  const noiseFloorRef = useRef(0.002);    // running estimate of ambient level (see VAD_ constants)

  const audioStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const processorRef = useRef(null);
  const buzzerRef = useRef(props.buzzer);
  const answerRef = useRef(props.answer);
  const actionRef = useRef({});
  useEffect(() => { buzzerRef.current = props.buzzer; }, [props.buzzer]);
  useEffect(() => { answerRef.current = props.answer; }, [props.answer]);

  function complete(answer) {
    props.setAnswer(answer.substr(answer.indexOf(" ") + 1).replace("stop", ""));
  }

  function setAnswer2(event) {
    props.setAnswer(event.target.value);
  }

  const textAnswer = useRef(null);

  function buzzin() {
    props.buzz();
    setTimeout(()=>{ if (textAnswer.current) textAnswer.current.focus(); }, 100);
  }

  function submit1(textOverride) {
    const answer = textOverride !== undefined ? textOverride : props.answer;
    console.log(answer);
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
    localBufferRef.current = emptyPcm();
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
        localBufferRef.current = emptyPcm();
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
      localBufferRef.current = emptyPcm();
      socketRef.current.emit('reset_audio_stream', {});
    } else {
      if (localBufferRef.current.length >= MIN_STREAM_SAMPLES) {
        runLocalTranscription(localBufferRef.current, true);
      }
      localBufferRef.current = emptyPcm();
      socketRef.current.emit('stop_audio_stream', {});
      socketRef.current.emit('start_audio_stream', {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.buzzer, username, speechMode]);

  // Apply a locally-transcribed chunk: update the answer box when buzzed in, detect the "buzz"
  // keyword otherwise. Mirrors the old partial_transcription/final_transcription socket handlers.
  function applyLocalTranscription(text, isFinal) {
    if (!text) return;
    if (buzzerRef.current === usernameRef.current) {
      const { cleaned, hasSubmit } = processTranscription(text);
      props.setAnswer(cleaned);
      if (hasSubmit) {
        // Clear the buffer BEFORE submitting, exactly as the buzz path does. Without this the
        // next pass re-transcribes the same audio — which still ends in "submit" — and re-runs
        // this branch: setAnswer() repopulates the box the submit had just cleared, and a second
        // answer is emitted that the server drops because the buzz is no longer active. That is
        // the "it left my text on screen and didn't submit" case: the first submit did land, then
        // the stale audio put the text back and the retry went nowhere.
        localBufferRef.current = emptyPcm();
        lastLocalTranscribeRef.current = Date.now();
        socketRef.current.emit('reset_audio_stream', {});
        actionRef.current.submit1(cleaned);
      }
    } else if (!isFinal && buzzerRef.current === '') {
      // Detect the "buzz" keyword in the most recent speech. Partial transcriptions cover the
      // full accumulated buffer (up to 10s), so checking the whole text's word count never
      // matches mid-question — only inspect the last few words. Immediately clear the local
      // buffer so the old "buzz" audio can't re-trigger after the cooldown expires.
      const words = text.trim().toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
      const recent = words.slice(-BUZZ_TAIL_WORDS);
      const now = Date.now();
      if (
        recent.some(w => BUZZ_TOKENS.has(w)) &&
        now - lastBuzzDetectRef.current > BUZZ_COOLDOWN_MS
      ) {
        lastBuzzDetectRef.current = now;
        localBufferRef.current = emptyPcm();
        socketRef.current.emit('reset_audio_stream', {});
        actionRef.current.buzzin();
      }
    }
  }

  async function runLocalTranscription(pcm, isFinal) {
    const text = stripNonSpeech(await localWhisper.transcribe(pcm));
    applyLocalTranscription(text, isFinal);
  }

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
      localBufferRef.current = merged.length > MAX_PARTIAL_SAMPLES
        ? merged.slice(merged.length - MAX_PARTIAL_SAMPLES)
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

      if (
        recentlyVoiced &&
        localBufferRef.current.length >= MIN_STREAM_SAMPLES &&
        !localWhisper.isTranscribing() &&
        now - lastLocalTranscribeRef.current >= STREAM_INTERVAL_MS
      ) {
        lastLocalTranscribeRef.current = now;
        runLocalTranscription(localBufferRef.current.slice(), false);
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
      localBufferRef.current = emptyPcm();
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
    </div>
  );
}

export default AnswerBox;
