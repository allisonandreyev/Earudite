import { useEffect } from "react";
import { useOnlineAnswering } from "asr-answering";
import SpeechRecognition from "react-speech-recognition";
import { ProgressBar } from "react-bootstrap";
import "../pkg/StackedProgressBar.css";

// Speech mode 1 — the legacy "say Go / say Stop" flow backed by asr-answering.
//
// This lives in its own component for a privacy reason, not a tidiness one. asr-answering calls
// SpeechRecognition.startListening({continuous: true}) directly in the body of useOnlineAnswering
// (dist/index.js:342), so the hook starts a continuous Web Speech recognizer on every render, in
// every speech mode, whether or not anything consumes the transcript. Web Speech runs its own
// browser-managed capture independent of our getUserMedia stream, so AnswerBox's mic-off toggle
// (speechMode 0) could not stop it — Chrome kept listening, and on Chrome that audio goes to
// Google's servers.
//
// The library exposes no way to switch that off: its stopListening() stops the TFJS command
// recognizer (dist/index.js:443), not Web Speech. Aborting from an effect doesn't work either,
// because the unguarded per-render startListening simply restarts it. Isolating the hook in a
// component that is only mounted for speechMode === 1 is what actually keeps it from running.
function LegacyVoiceAnswering(props) {
  const {
    initialize,
    startListening,
    stopListening,
    setIsReady,
    manager,
    ready,
    resetForNewQuestion,
    recordingState: status,
    timeLeft,
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
    isReady: true,
    onComplete: (answer) => props.onComplete(answer),
    gameTime: 9000000,
    onBuzzin: () => props.onBuzzin(),
    ASRthreshold: 0.8,
    onSubmit: () => props.onSubmit(),
  });

  // Mount: initialize the recognizer. Unmount (i.e. the user switched off mode 1): explicitly
  // abort Web Speech. Unsubscribing the hook is not enough — react-speech-recognition keeps a
  // singleton RecognitionManager that stays listening after its last subscriber unmounts, so
  // without this the mic would stay open exactly when the user asked for it to be closed.
  useEffect(() => {
    initialize();
    return () => {
      try {
        SpeechRecognition.abortListening();
      } catch (e) {
        // already stopped, or the browser has no Web Speech support — nothing to release
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset between questions, matching the timing AnswerBox used when it owned this hook.
  useEffect(() => {
    resetForNewQuestion();
    setIsReady(false);
    const readyTO = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(readyTO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.question]);

  useEffect(() => {
    if (!props.inGame) stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.inGame]);

  useEffect(() => {
    if (ready) {
      manager.resetStage();
      startListening();
    }
  }, [ready, manager, startListening]);

  const showProgress = ["recording", "stopping"].includes(status) || processingAudio;

  return (
    <div>
      {showProgress && (
        <div className="answerbox-asr-progressbar-wrapper">
          <ProgressBar
            now={(timeLeft / 6000) * 100}
            variant={"danger"}
            striped={true}
            animated={true}
            label={!processingAudio ? "Listening..." : "Processing..."}
          />
        </div>
      )}
      <div class="answerbox-answering-voice-instructions">
        Speech Recognition: Say
        <div class="answerbox-answering-voice-instructions-highlight">Go</div>
        to begin,
        <div class="answerbox-answering-voice-instructions-highlight">Stop</div>
        for the transcript, press
        <div class="answerbox-answering-voice-instructions-btn-highlight">Submit</div>
        to submit
      </div>
    </div>
  );
}

export default LegacyVoiceAnswering;
