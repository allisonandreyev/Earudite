import { useState, useEffect, useRef } from "react";
import { useOnlineAnswering } from "asr-answering";
import MicOffIcon from "@material-ui/icons/MicOff";
import { useRecoilValue } from "recoil";
import { AUTHTOKEN, PROFILE, URLS, SOCKET } from "../store";
import { useAlert } from "react-alert";
import axios from "axios";
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

    if(props.mode === 0) { // off

    } else if(props.mode === 1) { // ASR

    } else { // mode === 2, classifier

    }
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

// async function initialize2(foo, foo2) {
//   await foo().then(() => {foo2();});
// }


// Hook for the answer box at the bottom of all games
function AnswerBox(props) {
  const profile = useRecoilValue(PROFILE);
  const username = profile["username"];
  const urls = useRecoilValue(URLS);
  const authtoken = useRecoilValue(AUTHTOKEN);
  const alert = useAlert();
  const socket = useRecoilValue(SOCKET);
  const [speechMode, setSpeechMode] = useState(2);
  const speechModeRef = useRef(0);

  const [whisperUploading, setWhisperUploading] = useState(false);
  const [whisperStatus, setWhisperStatus] = useState("idle");
  const authRef = useRef(authtoken);
  const urlsRef = useRef(urls);
  const socketRef = useRef(socket);
  const alertRef = useRef(alert);
  useEffect(() => { authRef.current = authtoken; }, [authtoken]);
  useEffect(() => { urlsRef.current = urls; }, [urls]);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { alertRef.current = alert; }, [alert]);

  const audioStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  // ASR always picks up the wake word, this function removes it
  function complete(answer) {
    props.setAnswer(answer.substr(answer.indexOf(" ") + 1).replace("stop", ""));
  }

  // Sets answer when typed
  function setAnswer2(event) {
    props.setAnswer(event.target.value);
  }

  const textAnswer = useRef(null);
  const buzzedQuestionRef = useRef(props.question);
  const buzzedRoundRef = useRef(props.state.round);

  function whisperStart() {
    if (!audioStreamRef.current) {
      alert.error("Microphone not available");
      return;
    }
    const chunks = [];
    const recorder = new MediaRecorder(audioStreamRef.current);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      setWhisperStatus("stopped");
      setWhisperUploading(true);
      const formdata = new FormData();
      formdata.append("audio", blob);
      formdata.append("auth", authRef.current);
      formdata.append("question", buzzedQuestionRef.current);
      formdata.append("round", buzzedRoundRef.current);
      try {
        const response = await axios.post(
          urlsRef.current["socket_flask"] + "/audioanswerupload",
          formdata,
          { headers: { "content-type": "multipart/form-data" } }
        );
        const transcription = response.data["transcription"] || "";
        console.log("[Whisper] transcription:", transcription);
        if (transcription) props.setAnswer(transcription);
        socketRef.current.emit("audioanswer", {
          auth: authRef.current,
          filename: response.data["filename"],
          transcription,
        });
      } catch (e) {
        console.error("[Whisper] upload error", e);
        alert.error("Whisper submission failed");
      }
      setWhisperUploading(false);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setWhisperStatus("recording");
  }

  function whisperStop() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setWhisperStatus("stopping");
    }
  }

  function buzzin() {
    buzzedQuestionRef.current = props.question;
    buzzedRoundRef.current = props.state.round;
    props.buzz();
    setTimeout(()=>{textAnswer.current.focus();}, 100);
  }

  // useEffect(()=> {
  //   console.log(props.answer);
  // },[props.answer]);

  function submit1() {
    console.log(props.answer);
    props.submit(props.answer);
    props.setAnswer("");
  }

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
    isReady: (speechMode > 0),
    onComplete: async (answer, blob) => {
      if (speechMode === 2) {
        const formdata = new FormData();
        formdata.append("audio", blob);
        formdata.append("auth", authtoken);
        formdata.append("question", buzzedQuestionRef.current);
        formdata.append("round", buzzedRoundRef.current);

        console.log(blob);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = "test.wav";
        document.body.appendChild(a);
        a.click();

        // Whisper mode handles upload separately via stopWhisperRecording
      } else {
        complete(answer);
      }
    },
    gameTime: 9000000,
    onBuzzin: () => buzzin(),
    ASRthreshold: 0.8,
    onSubmit: () => {
      submit1();
    }
  });

  // On question change reset ASR
  useEffect(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    resetForNewQuestion();
    setIsReady(!(speechMode > 0));
    const readyTO = setTimeout(() => {
      setIsReady(speechMode > 0);
    }, 100);

    return () => {
      clearTimeout(readyTO);
    }
    // eslint-disable-next-line
  }, [props.question]);

  // useEffect(() => {
  //   console.log(timeLeft, processingAudio, status, listening);
  // }, [timeLeft, processingAudio, status, listening])

  // On speech mode change update if ASR is ready, and keep ref current
  useEffect(()=> {
    speechModeRef.current = speechMode;
    setIsReady(speechMode > 0);
    // eslint-disable-next-line
  },[speechMode]);

  useEffect(() => {
    if(!props.state.inGame) {
      stopListening();
    }
    // eslint-disable-next-line
  }, [props.state.inGame])

  // Start listening and reset stage when ready
  useEffect(() => {
    if(ready) {
      manager.resetStage();
      startListening();
    }
  }, [ready, manager, startListening]);

  useEffect(() => {
    if(props.buzzer !== username && !whisperUploading && whisperStatus === "idle") {
      props.setAnswer("");
    }
    // eslint-disable-next-line
  }, [props.buzzer, username, whisperUploading, whisperStatus])

  useEffect(()=> {
    console.log("IS LISTENING");
    initialize();
    // eslint-disable-next-line
  },[]);

  useKeyPress("Enter", submit1, [props.answer], true);
  useKeyPress(" ", buzzin, [], document.activeElement !== textAnswer.current);

  const [volume, setVolume] = useState(0);

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
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioContext) audioContext.close();
      audioStreamRef.current = null;
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

        {/* <div class="answerbox-switch-wrapper">
          <Tooltip
            // options
            title="Use voice commands"
            position="top"
            trigger="mouseenter"
            unmountHTMLWhenHide="true"
          >
            <VoiceBuzzSwitch setVoice={setReady2} />
          </Tooltip>
          {ready && props.classifiable && (
            <div>
              <Tooltip
                // options
                title="Use classifier"
                position="top"
                trigger="mouseenter"
                unmountHTMLWhenHide="true"
              >
                <UseClassifierSwitch setVoice={setUseClassifier} />
              </Tooltip>
            </div>
          )}
        </div> */}

        <div class="answerbox-button" onClick={buzzin}>
          Buzz
        </div>
        {speechMode === 2 && (props.buzzer === username || whisperStatus === "recording" || whisperStatus === "stopping" || whisperUploading) ? (
          <div
            class="answerbox-button"
            style={{"background-color": whisperStatus === "recording" ? "#e05050" : (whisperUploading || whisperStatus === "stopping") ? "#aaaaaa" : "#90E99C", cursor: (whisperUploading || whisperStatus === "stopping") ? "default" : "pointer"}}
            onClick={(whisperUploading || whisperStatus === "stopping") ? undefined : (whisperStatus === "recording" ? whisperStop : (props.buzzer === username ? whisperStart : undefined))}
          >
            {whisperUploading ? "Transcribing..." : whisperStatus === "recording" ? "Stop & Transcribe" : whisperStatus === "stopping" ? "Stopping..." : "Start Recording"}
          </div>
        ) : (
          <div class="answerbox-button" onClick={submit1}>
            Submit
          </div>
        )}
      </div>
      {speechMode === 2 && (whisperStatus === "recording" || whisperUploading) &&
        <div className="answerbox-asr-progressbar-wrapper">
          <ProgressBar now={100} variant={"danger"} striped={true} animated={true} label={whisperUploading ? "Transcribing..." : "Recording..."}/>
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
          Whisper: Buzz in → click
          <div class="answerbox-answering-voice-instructions-btn-highlight">Start Recording</div>
          → speak → click
          <div class="answerbox-answering-voice-instructions-btn-highlight">Stop &amp; Transcribe</div>
        </div>
      }
    </div>
  );
}

export default AnswerBox;
