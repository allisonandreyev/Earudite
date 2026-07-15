import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useOnlineAnswering } from "asr-answering";
import MicOffIcon from "@material-ui/icons/MicOff";
import { useRecoilValue } from "recoil";
import { PROFILE, SOCKET, MODEL_PREFERENCES } from "../store";
import { ASR_MODELS } from "../asrModels";
import { useAlert } from "react-alert";
import { ProgressBar } from "react-bootstrap";
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

function AnswerBox(props) {
  const profile = useRecoilValue(PROFILE);
  const username = profile["username"];
  const alert = useAlert();
  const socket = useRecoilValue(SOCKET);
  const [speechMode, setSpeechMode] = useState(2);
  const speechModeRef = useRef(2);

  // Quick per-session override of the saved answer-transcription model preference. Not
  // persisted — it only affects this session; the saved default lives in MODEL_PREFERENCES
  // and is edited from the Model Preferences page.
  const modelPreferences = useRecoilValue(MODEL_PREFERENCES);
  const [asrModel, setAsrModel] = useState(modelPreferences.answerModel);
  const asrModelRef = useRef(asrModel);
  useEffect(() => { asrModelRef.current = asrModel; }, [asrModel]);

  const socketRef = useRef(socket);
  const alertRef = useRef(alert);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { alertRef.current = alert; }, [alert]);

  const lastBuzzDetectRef = useRef(0);

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

  // Strip the word "submit" from Whisper output, return cleaned text + whether to submit
  function processTranscription(text) {
    const hasSubmit = /\bsubmit\b/i.test(text);
    const cleaned = text.replace(/\bsubmit\b/gi, '').replace(/\s+/g, ' ').trim();
    return { cleaned, hasSubmit };
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

  const {
    initialize,
    startListening,
    setIsReady,
    // eslint-disable-next-line
    stopListening,
    // eslint-disable-next-line
    listening,
    // eslint-disable-next-line
    recordingState: status,
    // eslint-disable-next-line
    timeLeft,
    // eslint-disable-next-line
    voiceState,
    // eslint-disable-next-line
    volumeUnused,
    // eslint-disable-next-line
    answer,
    // eslint-disable-next-line
    permissions,
    // eslint-disable-next-line
    error,
    // eslint-disable-next-line
    errormsg,
    // eslint-disable-next-line
    manager,
    // eslint-disable-next-line
    ready,
    resetForNewQuestion,
    processingAudio,
  } = useOnlineAnswering({
    audio: {
      buzzin:
        "https://assets.mixkit.co/sfx/download/mixkit-game-show-wrong-answer-buzz-950.wav",
      buzzout:
        "https://assets.mixkit.co/sfx/download/mixkit-game-show-wrong-answer-buzz-950.wav",
    },
    onAudioData: () => {},
    timeout: 6000,
    isReady: (speechMode === 1),
    onComplete: (answer) => {
      if (speechMode === 1) complete(answer);
    },
    gameTime: 9000000,
    onBuzzin: () => buzzin(),
    ASRthreshold: 0.8,
    onSubmit: () => {
      if (speechMode === 1) submit1();
    }
  });

  // On question change: reset server buffer and ASR state
  useEffect(() => {
    if (speechModeRef.current === 2) {
      socketRef.current.emit('reset_audio_stream', {});
    } else if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
      socketRef.current.emit('stop_audio_stream', {});
    }
    resetForNewQuestion();
    setIsReady(false);
    const readyTO = setTimeout(() => {
      setIsReady(speechModeRef.current === 1);
    }, 100);

    return () => {
      clearTimeout(readyTO);
    }
    // eslint-disable-next-line
  }, [props.question]);

  // Sync speechMode into ref and update hook readiness
  useEffect(()=> {
    speechModeRef.current = speechMode;
    setIsReady(speechMode === 1);

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
      }
    }
    // eslint-disable-next-line
  },[speechMode]);

  useEffect(() => {
    if(!props.state.inGame) {
      stopListening();
    }
    // eslint-disable-next-line
  }, [props.state.inGame])

  // Start listening and reset stage when ready (mode 1 only)
  useEffect(() => {
    if(ready && speechMode === 1) {
      manager.resetStage();
      startListening();
    }
  }, [ready, manager, startListening, speechMode]);

  useEffect(() => {
    if (props.buzzer !== "" && props.buzzer !== username) props.setAnswer("");
    // eslint-disable-next-line
  }, [props.buzzer, username])

  useEffect(()=> {
    console.log("IS LISTENING");
    initialize();
    // eslint-disable-next-line
  },[]);

  // In Whisper mode: reset server buffer on buzz-in so answer transcription starts fresh;
  // on buzz-out, finalize the buffer then immediately restart for keyword detection.
  useEffect(() => {
    if (speechMode !== 2) return;
    if (props.buzzer === username) {
      socketRef.current.emit('reset_audio_stream', {});
    } else {
      socketRef.current.emit('stop_audio_stream', {});
      socketRef.current.emit('start_audio_stream', { model: asrModelRef.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.buzzer, username, speechMode]);

  // Whisper partial transcription: update answer box when buzzed in, detect "buzz" keyword otherwise
  useEffect(() => {
    const handler = ({ text }) => {
      if (!text) return;
      if (buzzerRef.current === username) {
        const { cleaned, hasSubmit } = processTranscription(text);
        props.setAnswer(cleaned);
        if (hasSubmit) actionRef.current.submit1(cleaned);
      } else if (buzzerRef.current === '') {
        // Detect the "buzz" keyword in the most recent speech. Partial transcriptions
        // cover the full accumulated buffer (up to 10 s), so checking the whole text's
        // word count never matches mid-question — only inspect the last few words.
        // Immediately reset the server buffer so the old "buzz" audio can't re-trigger
        // after the cooldown expires.
        const words = text.trim().toLowerCase().split(/\s+/);
        const recent = words.slice(-3);
        const now = Date.now();
        if (
          recent.some(w => /^buzz[.!?]?$/.test(w)) &&
          now - lastBuzzDetectRef.current > 2000
        ) {
          lastBuzzDetectRef.current = now;
          socketRef.current.emit('reset_audio_stream', {});
          actionRef.current.buzzin();
        }
      }
    };
    socket.on('partial_transcription', handler);
    return () => socket.off('partial_transcription', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, username]);

  // Final full-buffer transcription after buzz-out
  useEffect(() => {
    const handler = ({ text }) => {
      if (!text || buzzerRef.current !== username) return;
      const { cleaned, hasSubmit } = processTranscription(text);
      props.setAnswer(cleaned);
      if (hasSubmit) actionRef.current.submit1(cleaned);
    };
    socket.on('final_transcription', handler);
    return () => socket.off('final_transcription', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, username]);

  useKeyPress("Enter", submit1, [props.answer], true);
  useKeyPress(" ", buzzin, [], document.activeElement !== textAnswer.current);

  const [volume, setVolume] = useState(0);

  function startPCMStream() {
    const ctx = audioContextRef.current;
    socketRef.current.emit('start_audio_stream', { model: asrModelRef.current });
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const pcm = downsampleTo16k(e.inputBuffer.getChannelData(0), ctx.sampleRate);
      socketRef.current.emit('audio_chunk', pcm.buffer);
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
        {speechMode === 2 &&
          <select
            class="answerbox-asr-model-select"
            value={asrModel}
            disabled={props.buzzer === username}
            title="ASR model for this session (quick override — set your default on the Model Preferences page)"
            onChange={(e) => setAsrModel(e.target.value)}
          >
            {ASR_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        }

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
      {speechMode !== 2 && (['recording', 'stopping'].includes(status) || processingAudio) &&
        <div className="answerbox-asr-progressbar-wrapper">
          <ProgressBar now={timeLeft/6000*100} variant={"danger"} striped={true} animated={true} label={(!processingAudio ? "Listening..." : "Processing...")}/>
        </div>
      }

      {speechMode === 1 &&
        <div class="answerbox-answering-voice-instructions">
          Speech Recognition: Say
          <div class="answerbox-answering-voice-instructions-highlight">Go</div>
          to begin,
          <div class="answerbox-answering-voice-instructions-highlight">Stop</div>
          for the transcript, press
          <div class="answerbox-answering-voice-instructions-btn-highlight">Submit</div>
          to submit
        </div>
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
