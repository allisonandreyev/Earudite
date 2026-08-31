import "../styles/Game.css";
import "../styles/WhitePanel.css";
import React, { useState, useEffect, useReducer, useRef } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import {
  SCREEN,
  PLAY_SCREEN,
  LOBBY_CODE,
  SOCKET,
  AUTHTOKEN,
  PROFILE,
  URLS,
  GAMESETTINGS,
} from "../store";
import AnswerBox from "./AnswerBox.jsx";
// import axios from 'axios';

// icons
import PersonIcon from "@material-ui/icons/Person";
import CloseIcon from '@material-ui/icons/Close';
import ThumbUpIcon from '@material-ui/icons/ThumbUp';
import ThumbDownIcon from '@material-ui/icons/ThumbDown';
import CheckIcon from '@material-ui/icons/Check';

import { useQuestion } from "online-answering";
import { Tooltip } from "react-tippy";
import {
  ProgressBarVariant,
  StackedProgressBar,
} from "../pkg/StackedProgressBar";
import Confetti from "react-confetti";
import { useWindowSize } from "react-use";

function KeybindControlsInstructions(props) {
  return (
    <div class="game-keybinds-card-wrapper">
      Keybinds:
      <div class="game-keybinds-keybind">
        <div class="game-keybinds-key-wrapper-space">
          <div class="game-keybinds-key-space">␣</div>
        </div>
        <div class="game-keybinds-key-text">
          to buzz
        </div>
      </div>
      <div class="game-keybinds-keybind">
        <div class="game-keybinds-key-wrapper-enter">
          <div class="game-keybinds-key-enter">Enter ↵</div>
        </div>
        <div class="game-keybinds-key-text">
          to submit
        </div>
      </div>
    </div>
  );
}

function PreviousAnswerCard(props) {
  return (
    <div class="game-prevanswers-card-wrapper">
      {props.correct && 
        <CheckIcon style={{ color:"#B0F5AB" }}/>
      }
      {!props.correct && 
        <CloseIcon style={{ color:"#FC94A1" }}/>
      }
      <div class="game-prevanswers-card-answer">
        {props.answer}
      </div>
    </div>
  )
}

function PreviousAnswers(props) {
  return (
    <div class="game-team-wrapper game-team-standings game-prevanswers-wrapper">
      <div class="game-team-title">Answers</div>
        <div class="game-team-body">
          {props.answers.map(([answer, correct]) => (
            <PreviousAnswerCard
              answer={answer}
              correct={correct}
            />
          ))}
        </div>
    </div>
  )
}

function GameRatePopup(props) {
  const [showing, setShowing] = useState("hidden");
  const [hoverUp, setHoverUp] = useState(false);
  const [hoverDown, setHoverDown] = useState(false);
  const socket = useRecoilValue(SOCKET);
  const authtoken = useRecoilValue(AUTHTOKEN);
  const [prevQ, setPrevQ] = useState(props.state.question);

  useEffect(() => {
    if(props.finished) {
      setShowing("vote");
    }
  },[props.finished])

  useEffect(() => {
    if(props.state.question !== prevQ && props.state.question > 1) {
      setPrevQ(props.state.question);
      setShowing("vote");
    }
  },[props.state, prevQ])

  useEffect(()=> {
    setHoverUp(false);
    setHoverDown(false);
  }, [showing])

  function UpClick() {
    setShowing("thanks");
    socket.emit("feedback", {
      auth: authtoken,
      vote: "good"
    });
  }

  function DownClick() {
    setShowing("thanks");
    socket.emit("feedback", {
      auth: authtoken,
      vote: "bad"
    });
  }

  if(showing === "vote") {
    return (
      <div id="game-rate-popup">
        <div class="game-rate-wrapper">
          <div class="game-rate-header">
            <div class="game-rate-header-title">
              How was that recording?
            </div>
          </div>
          <div class="game-rate-btn-wrapper">
            {!hoverUp &&
              <div class="game-rate-btn" onMouseEnter={()=>{setHoverUp(true)}} onMouseLeave={()=>{setHoverUp(false)}} onClick={UpClick}>
                <ThumbUpIcon style={{ color:"lightgray" }}/>
              </div>
            }
            {hoverUp &&
              <div class="game-rate-btn game-rate-btn-green" onMouseEnter={()=>{setHoverUp(true)}} onMouseLeave={()=>{setHoverUp(false)}} onClick={UpClick}>
                <ThumbUpIcon style={{ color:"#B0F5AB" }}/>
              </div>
            }
            
            {!hoverDown &&
              <div class="game-rate-btn" onMouseEnter={()=>{setHoverDown(true)}} onMouseLeave={()=>{setHoverDown(false)}} onClick={DownClick}>
                <ThumbDownIcon style={{ color:"lightgray" }}/>
              </div>
            }
            {hoverDown &&
              <div class="game-rate-btn game-rate-btn-red" onMouseEnter={()=>{setHoverDown(true)}} onMouseLeave={()=>{setHoverDown(false)}} onClick={DownClick}>
                <ThumbDownIcon style={{ color:"#FC94A1" }}/>
              </div>
            }
          </div>
        </div>
      </div>
    )
  } else if(showing === "thanks") {
    return (
      <div id="game-rate-popup">
        <div class="game-rate-wrapper">
          <div class="game-rate-header">
            <div class="game-rate-header-title">
              Thank you for your feedback! 
            </div>
          </div>
        </div>
      </div>
    )
  } else {
    return (
      <div></div>
    )
  }
}

// player display w/ score in-game
function PlayerCard(props) {
  const profile = useRecoilValue(PROFILE);
  const username = profile["username"];
  return (
    <div
      className={
        "game-playercard-wrapper " +
        (props.name === username ? "game-playercard-self " : "") +
        (props.currentlyBuzzed ? "game-playercard-buzzed-outline " : "")
      }
    >
      <div class="game-playercard-username-wrapper">
        {props.name}
        {props.name === username && (
          <Tooltip
            // options
            title="This is you"
            position="top"
            trigger="mouseenter"
            unmountHTMLWhenHide="true"
          >
            <PersonIcon style={{ color: "blue", marginLeft: "0.25rem" }} />
          </Tooltip>
        )}
      </div>
      <div class="game-playercard-username-wrapper">
        {props.currentlyBuzzed && (
          <div class="game-playercard-buzzed-timer">
            {props.buzzTime}
            <div class="game-playercard-buzzed-divider"></div>
          </div>
        )}
        <div class="game-playercard-points">{props.points}</div>
      </div>
    </div>
  );
}

// player display w/ score post-game
function PostgamePlayerCard(props) {
  const profile = useRecoilValue(PROFILE);
  const username = profile["username"];

  return (
    <div className={"game-postgame-playercard-wrapper"}>
      <div
        className={
          "game-playercard-username-wrapper" +
          (props.name === username ? " game-postgame-color-blue" : "")
        }
      >
        {props.name}
        {props.name === username && (
          <Tooltip
            // options
            title="This is you"
            position="top"
            trigger="mouseenter"
            unmountHTMLWhenHide="true"
          >
            <PersonIcon style={{ color: "blue", marginLeft: "0.25rem" }} />
          </Tooltip>
        )}
      </div>
      <div class="game-playercard-username-wrapper">
        <div class="game-playercard-points">{props.points}</div>
      </div>
    </div>
  );
}

// teamcard wrapping playercards
function TeamCard(props) {
  const setScreen = useSetRecoilState(SCREEN);
  const setPlayScreen = useSetRecoilState(PLAY_SCREEN);
  const socket = useRecoilValue(SOCKET);
  const authtoken = useRecoilValue(AUTHTOKEN);
  if (props.points[0] === undefined) {
    const pointsArray = [];
    for (const key in props.points) {
      pointsArray.push([key, props.points[key]]);
    }
    return (
      <div
        className={
          "game-team-wrapper " +
          (props.color === "red" ? "game-team-red " : "") +
          (props.color === "yellow" ? "game-team-yellow " : "") +
          (props.color === "standings" ? "game-team-standings " : "")
        }
      >
        <div class="game-team-title">Scoreboard</div>
        <div class="game-team-body">
          {pointsArray.map(([uname, pts]) => (
            <PlayerCard
              name={uname}
              points={pts}
              currentlyBuzzed={props.buzzer === uname}
              buzzTime={props.buzzTime}
            />
          ))}
        </div>
        <KeybindControlsInstructions/>
        <div
          onClick={() => {
            socket.emit("leavelobby", {
              auth: authtoken
            });
            setPlayScreen("home");
            setScreen(3);
          }}
          class="game-quitbtn"
        >
          Quit
        </div>
      </div>
    );
  } else {
    const pointsArray1 = [];
    let team1pts = 0;
    let team2pts = 0;
    for (const key in props.points[0]) {
      pointsArray1.push([key, props.points[0][key]]);
      team1pts += props.points[0][key];
    }
    const pointsArray2 = [];
    for (const key in props.points[1]) {
      pointsArray2.push([key, props.points[1][key]]);
      team2pts += props.points[1][key];
    }
    return (
      <div
        className={
          "game-team-wrapper " +
          (props.color === "red" ? "game-team-red " : "") +
          (props.color === "yellow" ? "game-team-yellow " : "") +
          (props.color === "standings" ? "game-team-standings " : "")
        }
      >
        <div class="game-team-title">Scoreboard</div>
        <div class="game-team-body">
          <div>
            Team 1 - {team1pts}
            {pointsArray1.map(([uname, pts]) => (
              <PlayerCard
                name={uname}
                points={pts}
                currentlyBuzzed={props.buzzer === uname}
                buzzTime={props.buzzTime}
              />
            ))}
          </div>
          <div>
            Team 2 - {team2pts}
            {pointsArray2.map(([uname, pts]) => (
              <PlayerCard
                name={uname}
                points={pts}
                currentlyBuzzed={props.buzzer === uname}
                buzzTime={props.buzzTime}
              />
            ))}
          </div>
        </div>
        <KeybindControlsInstructions/>
        <div
          onClick={() => {
            socket.emit("leavelobby", {
              auth: authtoken
            });
            setPlayScreen("home");
            setScreen(3);
          }}
          class="game-quitbtn"
        >
          Quit
        </div>
      </div>
    );
  }
}

// game hook
function Game() {
  const profile = useRecoilValue(PROFILE);
  const username = profile["username"];
  const [state, setState] = useReducer(
    (state, newState) => ({ ...state, ...newState }),
    {
      round: 0,
      question: 0,
      buzzer: "",
      username: username,
      questionTime: 0,
      buzzTime: 0,
      gapTime: 0,
      inGame: true,
      answerText: "",
      prevAnswers: [],
      // Canonical answer for the question that just ended, sent by the server for the whole gap.
      correctAnswer: "",
      socket: useRecoilValue(SOCKET),
      points: new Map([[username, 0]]),
      lobby: useRecoilValue(LOBBY_CODE),
    }
  );
    
  navigator.mediaSession.setActionHandler("play", async function () {
    // console.log('> User clicked "Play" icon.');
    // await video.play();
    // Do something more than just playing video...
  });

  navigator.mediaSession.setActionHandler("pause", function () {
    // console.log('> User clicked "Pause" icon.');
    // video.pause();
    // Do something more than just pausing video...
  });

  const authtoken = useRecoilValue(AUTHTOKEN);
  const [gameScreen, setGameScreen] = useState("ingame");
  const setScreen = useSetRecoilState(SCREEN);
  const setPlayScreen = useSetRecoilState(PLAY_SCREEN);
  const gameSettings = useRecoilValue(GAMESETTINGS);
  // console.log(gameSettings);
  const [totalTime, setTotalTime] = useState(40);
  // A REF, not state. gameStateListener is registered once (see the socket effect's deps), so it
  // closes over whatever this was on the first render forever. As state, `totalTimeBeenSet` was
  // therefore permanently false inside the listener, so setTotalTime(data[3]) ran on EVERY
  // gamestate tick — ~10 times a second — and `totalTime` tracked the time REMAINING instead of
  // the question's total. That made the question progress bar's own denominator shrink with the
  // numerator, so its blue segment sat near 100% and never visibly drained. The gap bar was
  // unaffected because it divides by gameSettings.gap_time, which is stable — which is exactly
  // why one timer worked and the other did not.
  const totalTimeSetRef = useRef(false);
  const [showConffeti, setShowConfetti] = useState(false);

  const { width, height } = useWindowSize();

  // for HLS
  const [token, setToken] = useState("");
  const [rid, setRid] = useState("");
  const [classifiable, setClassifiable] = useState(true);

  // URLS
  const urls = useRecoilValue(URLS);

  // ANSWER BOX
  const [answerText, setAnswerText] = useState("");
  const [lastSubmittedAnswer, setLastSubmittedAnswer] = useState("");
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(null);
  // True when this player's buzz expired before they sent anything.
  const [lastBuzzTimedOut, setLastBuzzTimedOut] = useState(false);

  // The socket listeners are registered ONCE (see the effect below). These refs give them current
  // values without putting those values in the effect's dependency list. Declared here, ahead of
  // that effect, so the reference order reads correctly.
  const stateRef = useRef(state);
  const gameSettingsRef = useRef(gameSettings);
  const usernameRef = useRef(username);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { gameSettingsRef.current = gameSettings; }, [gameSettings]);
  useEffect(() => { usernameRef.current = username; }, [username]);

  // The reveal panel describes one question. Clear it when the next one starts, otherwise the
  // previous question's "Your answer" lingers through the whole of the next question.
  useEffect(() => {
    setLastSubmittedAnswer("");
    setLastAnswerCorrect(null);
    setLastBuzzTimedOut(false);
  }, [state.question, state.round]);

  useEffect(() => {
    const buzzerListener = (data) => {
      // Guard the pause: if the <video> is momentarily absent this used to throw, and the
      // setState below — the line that actually puts the UI into the buzzed-in state — never ran.
      var video = document.getElementById("hls");
      if (video) video.pause();
      setState({ buzzer: data });
    };

    const gameStateListener = (data) => {
      if (data[0] === false) {
        setGameScreen("postgame");
      }
      if (!totalTimeSetRef.current) {
        totalTimeSetRef.current = true;
        setTotalTime(data[3]);
      }
      setState({
        inGame: data[0],
        round: data[1],
        question: data[2],
        questionTime: data[3].toFixed(1), // rounds to nearest tenth
        buzzTime: data[4].toFixed(1),
        gapTime: data[5].toFixed(1),
        buzzer: data[6],
        points: data[7],
        prevAnswers: data[8] || [],
        correctAnswer: data[9] || "",
      });
    };

    // These two are broadcast to the entire room. Only adopt the verdict when it is about this
    // player — otherwise another player answering flipped your "Correct answer" line.
    const isMine = (data) => !data || !data.username || data.username === usernameRef.current;

    const answeredIncorrectlyListener = (data) => {
      var video = document.getElementById("hls");
      if (video && stateRef.current.questionTime > gameSettingsRef.current['post_buzz_time']) {
        video.play();
      }
      if (isMine(data)) {
        setLastAnswerCorrect(false);
        if (data && data.timedOut) setLastBuzzTimedOut(true);
      }
    };

    const answeredCorrectlyListener = (data) => {
      if (isMine(data)) setLastAnswerCorrect(true);
    };

    const hlsListener = (data) => {
      var div = document.getElementById("transcript-box");
      if (div) div.textContent = "";
      lastCueRef.current = "";
      // console.log(data["token"]);
      // console.log(data["rid"]);
      setToken(data["token"]);
      setRid(data["rid"]);
      setClassifiable(data["classifiable"]);
      setAnswerText("");
      setLastSubmittedAnswer("");
      setLastAnswerCorrect(null);
      setLastBuzzTimedOut(false);
      totalTimeSetRef.current = false;
    };

    const hlsPlayListener = (data) => {
      var video = document.getElementById("hls");
      if (video) video.play();
    };

    state.socket.on("buzzed", buzzerListener);
    state.socket.on("gamestate", gameStateListener);
    state.socket.on("answeredincorrectly", answeredIncorrectlyListener);
    state.socket.on("answeredcorrectly", answeredCorrectlyListener);
    state.socket.on("hlsupdate", hlsListener);
    state.socket.on("hlsplay", hlsPlayListener);

    return function cleanSockets() {
      state.socket.off("buzzed", buzzerListener);
      state.socket.off("gamestate", gameStateListener);
      state.socket.off("answeredincorrectly", answeredIncorrectlyListener);
      state.socket.off("answeredcorrectly", answeredCorrectlyListener);
      state.socket.off("hlsupdate", hlsListener);
      state.socket.off("hlsplay", hlsPlayListener);
    };
    // Registered once per socket. This effect previously had NO dependency array, so it tore down
    // and re-attached all six handlers on every single render — and the server emits gamestate
    // roughly ten times a second, so that was ~10 full re-registrations per second for the whole
    // game, on top of leaking two <video> listeners each time (they were added here but only ever
    // removed by the socket cleanup, which did not cover them). The accumulated listeners and
    // churn are what made the page progressively less responsive to a Buzz click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.socket]);

  // The media-session hooks belong to the <video>, not to the socket, and need their own cleanup.
  useEffect(() => {
    const video = document.getElementById("hls");
    if (!video) return;
    const onPlay = () => { navigator.mediaSession.playbackState = "playing"; };
    const onPause = () => { navigator.mediaSession.playbackState = "paused"; };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  //Confetti
  const [prevState, setPrevState] = useState(state);
  useEffect(() => {
    if (prevState.points[username] < state.points[username]) {
      setShowConfetti(true);
      setTimeout(() => {
        setShowConfetti(false);
      }, 5000);
    }
    setPrevState(state);
  }, [username, state, prevState.points]);

  // const [hls, isParsed] =
  useQuestion({
    onCue: () => {},  // cue display handled by the addtrack effect below
    backend_url: urls["HLS"] + "/hls",
    recording_id: rid,
    token: token,
    header: "x-gostreamer-token",
    mediaId: "hls",
    listeners: {
      seeking: false,
    },
  });

  // Last cue rendered into the transcript box, so a repeated cuechange does not duplicate it.
  const lastCueRef = useRef("");


  // Attach cuechange listeners via addtrack so they survive hls.js detach/reattach
  // between questions. useQuestion's loadedmetadata approach is removed on pause,
  // breaking text display for question 2+.
  useEffect(() => {
    const video = document.getElementById("hls");
    if (!video) return;

    function onCueChange(e) {
      const raw = e.currentTarget?.activeCues?.[0]?.text;
      if (!raw) return;
      const div = document.getElementById("transcript-box");
      if (!div) return;
      // Strip WebVTT markup ("<v Speaker 0>", <b>, <i>, timestamps). innerHTML used to hide these
      // by parsing them as unknown elements; textContent would print them verbatim.
      const cue = raw.replace(/<[^>]*>/g, "").trim();
      if (!cue) return;
      // Dedupe against the whole previous cue. The old check split on spaces and compared only
      // the final word, so any multi-word cue slipped through and was appended repeatedly.
      if (cue === lastCueRef.current) return;
      lastCueRef.current = cue;
      // textContent, not innerHTML: cue text is dataset content, and 687 of the sound-captioning
      // prompts contain bracketed answer-format examples. The box is white-space: pre-wrap, so
      // the newlines inside a multi-line cue render as real line breaks.
      div.textContent = div.textContent ? div.textContent + "\n" + cue : cue;
    }

    function onAddTrack(e) {
      e.track.mode = "showing";
      e.track.addEventListener("cuechange", onCueChange);
    }

    video.textTracks.addEventListener("addtrack", onAddTrack);
    return () => video.textTracks.removeEventListener("addtrack", onAddTrack);
  }, []);

  function buzz() {
    state.socket.emit("buzz", {
      auth: authtoken,
    });
  }

  function answer(txt) {
    // console.log("answered",txt);
    setLastSubmittedAnswer(txt);
    state.socket.emit("answer", {
      auth: authtoken,
      answer: txt,
    });
  }

  if (gameScreen === "ingame") {
    return (
      <React.Fragment>
        {showConffeti && <Confetti width={width} height={height} />}
        <div class="game1-big-white-panel-wrapper">
          <div>
            <div>
              <video id="hls" controls hidden></video>
            </div>
          </div>

          <GameRatePopup state={state} finished={false}/>

          <div class="game1-big-white-panel">
            <div class="game1-content-wrapper">
              <div class="game-content-wrapper">
                <div class="game-header-wrapper">
                  <div class="game-header-rq">
                    R: {state.round} / Q: {state.question}
                  </div>

                  {state.gapTime < gameSettings.gap_time && (
                    <div class="game-header-time">
                      <div class="game-header-time-sep">{state.gapTime}s</div>
                      <div style={{ width: "21rem" }}>
                        <StackedProgressBar
                          barData={[{ width: 100 }]}
                          progressData={[
                            Math.round(
                              (state.gapTime / gameSettings.gap_time) *
                                100
                            ),
                          ]}
                          striped={true}
                          // animated={true}
                        ></StackedProgressBar>
                      </div>
                    </div>
                  )}
                  {state.gapTime >= gameSettings.gap_time && (
                    <div class="game-header-time">
                      <div class="game-header-time-sep">
                        {state.questionTime}s
                      </div>
                      <div style={{ width: "21rem" }}>
                        {(() => {
                          // questionTime arrives as a string (data[3].toFixed(1)), so coerce
                          // before any arithmetic that isn't already doing it implicitly.
                          const remaining = Number(state.questionTime);
                          const postBuzz = gameSettings.post_buzz_time;
                          // Both denominators can legitimately reach zero — post_buzz_time is a
                          // lobby slider that goes down to 0, and totalTime equals it on a very
                          // short question. Dividing there produced Infinity/NaN and the bar
                          // rendered blank, so clamp to 1 and let the segment simply sit empty.
                          const readSpan = Math.max(1, totalTime - postBuzz);
                          const buzzSpan = Math.max(1, postBuzz);
                          const readPct = Math.round((readSpan / Math.max(1, totalTime)) * 100);
                          const pct = (v) => Math.max(0, Math.min(100, Math.round(v)));
                          return (
                            <StackedProgressBar
                              barData={[
                                { width: 100 - readPct, color: ProgressBarVariant.red },
                                { width: readPct, color: ProgressBarVariant.blue },
                              ]}
                              progressData={[
                                pct((Math.min(remaining, postBuzz) / buzzSpan) * 100),
                                pct(((remaining - postBuzz) / readSpan) * 100),
                              ]}
                              striped={true}
                              animated={true}
                            ></StackedProgressBar>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  class="game-transcriptbox"
                  id="transcript-box"
                  className={
                    "game-transcriptbox " +
                    (state.buzzer !== "" ? "game-buzzedin-blur" : "")
                  }
                ></div>

                <div class="game-menubox">
                  <AnswerBox
                    buzz={buzz}
                    buzzer={state.buzzer}
                    submit={answer}
                    questionTime={state.questionTime}
                    state={state}
                    classifiable={classifiable}
                    answer={answerText}
                    setAnswer={setAnswerText}
                    question={state.question}
                  />
                </div>
              </div>
            </div>
          </div>
          <div class="game-right-wrapper">
            <TeamCard
              color="standings"
              points={state.points}
              buzzer={state.buzzer}
              buzzTime={state.buzzTime}
            />
            {/* Shown for the whole gap after each question. The panel is driven by the server's
                canonical answer (gamestate data[9]) rather than by whether this player happened
                to answer, so the reveal appears every time the countdown ends — including for
                players who never buzzed. "Your answer" is the only part that depends on having
                submitted something. */}
            {(state.correctAnswer || lastSubmittedAnswer || lastBuzzTimedOut) && (
              <div className="game-team-wrapper game-team-standings game-submitted-answer-panel">
                {lastBuzzTimedOut && !lastSubmittedAnswer && (
                  <div className="game-submitted-answer-row">
                    <span className="game-submitted-answer-label">Your answer:</span>
                    <span className="game-submitted-answer-text">
                      Buzz timed out — no answer sent
                    </span>
                  </div>
                )}
                {lastSubmittedAnswer && (
                  <div className="game-submitted-answer-row">
                    <span className="game-submitted-answer-label">Your answer:</span>
                    <span className="game-submitted-answer-text">{lastSubmittedAnswer}</span>
                    {lastAnswerCorrect === true && (
                      <CheckIcon style={{ color: "#B0F5AB" }} />
                    )}
                    {lastAnswerCorrect === false && (
                      <CloseIcon style={{ color: "#FC94A1" }} />
                    )}
                  </div>
                )}
                {(() => {
                  // Never echo the player's own text here: answers are judged by fuzzy match, so
                  // a "correct" answer is often only a partial of the real one.
                  const canonical =
                    state.correctAnswer ||
                    ([...state.prevAnswers].reverse().find(([, correct]) => correct) || [])[0];
                  if (!canonical) return null;
                  return (
                    <div className="game-submitted-answer-row">
                      <span className="game-submitted-answer-label">Correct answer:</span>
                      <span className="game-submitted-answer-text">{canonical}</span>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </React.Fragment>
    );
  } else {
    if (state.points[0] === undefined) {
      const pointsArray = [];

      for (const key in state.points) {
        pointsArray.push([key, state.points[key]]);
      }

      return (
        <div class="big-white-panel-wrapper">
          <GameRatePopup state={state} finished={true}/>
          <div class="big-white-panel">
            <div class="game-postgame-content-wrapper">
              <div class="game-postgame-standings-title">Final Standings</div>
              <div class="game-postgame-standings-wrapper">
                {pointsArray.map(([uname, pts]) => (
                  <PostgamePlayerCard name={uname} points={pts} />
                ))}
              </div>
              <div
                onClick={() => {
                  state.socket.emit("leavelobby", {
                    auth: authtoken
                  });
                  setPlayScreen("home");
                  setScreen(3);
                }}
                class="game-postgame-return-btn"
              >
                Back to home
              </div>
            </div>
          </div>
        </div>
      );
    } else {
      const pointsArray1 = [];
      const pointsArray2 = [];
      let team1pts = 0;
      let team2pts = 0;
      for (const key in state.points[0]) {
        pointsArray1.push([key, state.points[0][key]]);
        team1pts += state.points[0][key];
      }
      for (const key in state.points[1]) {
        pointsArray2.push([key, state.points[1][key]]);
        team2pts += state.points[1][key];
      }

      return (
        <div class="big-white-panel-wrapper">
          <GameRatePopup state={state} finished={true}/>
          <div class="big-white-panel">
            <div class="game-postgame-content-wrapper">
              <div class="game-postgame-standings-title">Final Standings</div>
              <div class="game-postgame-standings-wrapper">
                Team 1 - {team1pts}
                {pointsArray1.map(([uname, pts]) => (
                  <PostgamePlayerCard name={uname} points={pts} />
                ))}
                Team 2 - {team2pts}
                {pointsArray2.map(([uname, pts]) => (
                  <PostgamePlayerCard name={uname} points={pts} />
                ))}
              </div>
              <div
                onClick={() => {
                  state.socket.emit("leavelobby", {
                    auth: authtoken
                  });
                  setPlayScreen("home");
                  setScreen(3);
                }}
                class="game-postgame-return-btn"
              >
                Back to home
              </div>
            </div>
          </div>
        </div>
      );
    }
  }
}

export default Game;
