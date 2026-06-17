import "../styles/Game.css";
import "../styles/WhitePanel.css";
import React, { useState, useEffect, useReducer } from "react";
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
  const [totalTimeBeenSet, setTotalTimeBeenSet] = useState(false);
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

  useEffect(() => {
    const buzzerListener = (data) => {
      var video = document.getElementById("hls");
      video.pause();
      setState({ buzzer: data });
    };

    const gameStateListener = (data) => {
      if (data[0] === false) {
        setGameScreen("postgame");
      }
      if (!totalTimeBeenSet) {
        setTotalTime(data[3]);
        setTotalTimeBeenSet(true);
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
        prevAnswers: data[8],
      });
    };

    const answeredIncorrectlyListener = (data) => {
      var video = document.getElementById("hls");
      if(state.questionTime > gameSettings['post_buzz_time']) {
        video.play();
      }
      // console.log(data);
      // this.setBuzzTime(time);
      // TODO correct animation
    };

    const answeredCorrectlyListener = (data) => {
      // console.log(data);
      // this.setBuzzTime(time);
      // TODO correct animation
    };

    const hlsListener = (data) => {
      var div = document.getElementById("transcript-box");
      if (div) div.innerHTML = "";
      // console.log(data["token"]);
      // console.log(data["rid"]);
      setToken(data["token"]);
      setRid(data["rid"]);
      setClassifiable(data["classifiable"]);
      setAnswerText("");
      setTotalTimeBeenSet(false);
    };

    const hlsPlayListener = (data) => {
      var video = document.getElementById("hls");
      video.play();
    };

    var video = document.getElementById("hls");
    if (video) {
      video.addEventListener("play", function () {
        navigator.mediaSession.playbackState = "playing";
      });

      video.addEventListener("pause", function () {
        navigator.mediaSession.playbackState = "paused";
      });
    }

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
  });

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

  // Attach cuechange listeners via addtrack so they survive hls.js detach/reattach
  // between questions. useQuestion's loadedmetadata approach is removed on pause,
  // breaking text display for question 2+.
  useEffect(() => {
    const video = document.getElementById("hls");
    if (!video) return;

    function onCueChange(e) {
      const cue = e.currentTarget?.activeCues?.[0]?.text;
      if (!cue) return;
      const div = document.getElementById("transcript-box");
      if (!div) return;
      const parts = div.innerHTML.split(" ");
      if (cue === parts[parts.length - 1]) return;
      div.innerHTML = div.innerHTML + "  \n" + cue;
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
                        <StackedProgressBar
                          barData={[
                            {
                              width:
                                100 -
                                Math.round(
                                  ((totalTime - gameSettings.post_buzz_time) /
                                    totalTime) *
                                    100
                                ),
                              color: ProgressBarVariant.red,
                            },
                            {
                              width: Math.round(
                                ((totalTime - gameSettings.post_buzz_time) /
                                  totalTime) *
                                  100
                              ),
                              color: ProgressBarVariant.blue,
                            },
                          ]}
                          progressData={[
                            Math.round(
                              (Math.min(
                                state.questionTime,
                                gameSettings.post_buzz_time
                              ) /
                                gameSettings.post_buzz_time) *
                                100
                            ),
                            Math.max(
                              0,
                              Math.round(
                                ((state.questionTime -
                                  gameSettings.post_buzz_time) /
                                  (totalTime - gameSettings.post_buzz_time)) *
                                  100
                              )
                            ),
                          ]}
                          striped={true}
                          animated={true}
                        ></StackedProgressBar>
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
            {state.prevAnswers.length > 0 && 
              <PreviousAnswers answers={state.prevAnswers}/>
            }
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
