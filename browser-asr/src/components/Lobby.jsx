import "../styles/Lobby.css";
import { useState, useEffect, useReducer, useRef } from "react";
import PersonIcon from '@material-ui/icons/Person';
import { useRecoilState, useRecoilValue, useSetRecoilState } from "recoil";
import { LOBBY_CODE, SOCKET, PLAY_SCREEN, SCREEN, AUTHTOKEN, PROFILE, GAMESETTINGS } from "../store";
import { useVoiceCommands } from "../voice/registry";
import Slider from '@material-ui/core/Slider';
import SwapVertIcon from '@material-ui/icons/SwapVert';
import {
    Tooltip,
} from 'react-tippy';

// player hook in lobby w/ switching functionality
function Player(props) {
    const socket = useRecoilValue(SOCKET);
    const authtoken = useRecoilValue(AUTHTOKEN);

    function switchTeams() {
        if(!props.switchable) {
            return;
        }
        socket.emit("switchteam", {
            auth: authtoken,
            user: props.name,
        });
    }

    if(props.switchable) {
        return (
            <div className={"lobby-players-player-wrapper " + (props.self ? "lobby-players-player-self" : "")}> 
                <div class="lobby-players-player-wrapper-left">
                    {props.name}
                    {props.self && 
                        <Tooltip
                            // options
                            title="This is you"
                            position="top"
                            trigger="mouseenter"
                            unmountHTMLWhenHide="true"
                        >
                            <PersonIcon style={{color: "blue", marginLeft: "0.25rem"}}/>
                        </Tooltip>
                    }
                </div>
                <div class="lobby-players-switchteam-icon-wrapper" onClick={switchTeams}>
                    <SwapVertIcon style={{color: "grey", height: "25px"}}/>
                </div>
            </div>
        )
    } else {
        return (
            <div className={"lobby-players-player-wrapper " + (props.self ? "lobby-players-player-self" : "")}>           
                <div class="lobby-players-player-wrapper-left">
                    {props.name}
                    {props.self && 
                        <Tooltip
                            // options
                            title="This is you"
                            position="top"
                            trigger="mouseenter"
                            unmountHTMLWhenHide="true"
                        >
                            <PersonIcon style={{color: "blue", marginLeft: "0.25rem"}}/>
                        </Tooltip>
                    }
                </div> 
            </div>
        )
    }
    
}

// Taken from stack overflow, simply clones a JS object
function clone(obj) {
    var copy;

    // Handle the 3 simple types, and null or undefined
    if (null == obj || "object" != typeof obj) return obj;

    // Handle Date
    if (obj instanceof Date) {
        copy = new Date();
        copy.setTime(obj.getTime());
        return copy;
    }

    // Handle Array
    if (obj instanceof Array) {
        copy = [];
        for (var i = 0, len = obj.length; i < len; i++) {
            copy[i] = clone(obj[i]);
        }
        return copy;
    }

    // Handle Object
    if (obj instanceof Object) {
        copy = {};
        for (var attr in obj) {
            if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
        }
        return copy;
    }

    throw new Error("Unable to copy obj! Its type isn't supported.");
}


// A lobby settings slider.
//
// These used to be driven ENTIRELY by a value that arrives over the network: onChange emitted to
// the socket server, the server broadcast `lobbystate` to the room, and only that echo moved the
// thumb. MUI v4 makes that fatal rather than merely slow — its useControlled turns the Slider's
// internal setValueState into a no-op the moment a `value` prop is supplied, so the thumb had no
// local position of its own at all. Every pixel of a drag fired a socket emit and the thumb sat
// still until a round-trip landed, which is why dragging felt like it was ignoring you, and why a
// slow or dropped echo left the slider resting on a value nobody chose.
//
// So the thumb is driven locally and the network is touched once, on release. A value arriving
// from the server is adopted only when it cannot contradict what the user is doing right now.
function SettingSlider(props) {
    const { value, onCommit, ...sliderProps } = props;
    const [local, setLocal] = useState(value);
    const draggingRef = useRef(false);
    // The value we last sent and have not seen echoed back yet. Until that echo arrives the
    // server-derived `value` still holds the OLD number, so adopting it would snap the thumb back
    // for the length of one round-trip — exactly the flicker this is here to prevent.
    const pendingRef = useRef(null);
    const pendingTimerRef = useRef(null);

    useEffect(() => {
        if (draggingRef.current) return;          // never fight a drag in progress
        if (pendingRef.current !== null) {
            if (value !== pendingRef.current) return;   // somebody else's update, or a stale echo
            clearTimeout(pendingTimerRef.current);
            pendingRef.current = null;
        }
        setLocal(value);
    }, [value]);

    useEffect(() => () => clearTimeout(pendingTimerRef.current), []);

    function commit(v) {
        draggingRef.current = false;
        clearTimeout(pendingTimerRef.current);
        pendingRef.current = v;
        // If the echo never comes (a dropped update, a reconnect mid-drag), stop waiting for it —
        // otherwise the slider would sit on a value the server never accepted, with no way back.
        pendingTimerRef.current = setTimeout(() => { pendingRef.current = null; }, 4000);
        onCommit(v);
    }

    return (
        <div className="lobby-gamesettings-hor-flex">
            {/* The number is what people actually read; the 80px track could not show the
                difference between 17 and 18 seconds. */}
            <div className="lobby-gamesettings-slider-num">{local}</div>
            <div className="lobby-gamesettings-slider-wrapper">
                <Slider
                    {...sliderProps}
                    value={local}
                    valueLabelDisplay="auto"
                    // Local only. The thumb has to track the cursor without waiting for anyone.
                    onChange={(event, v) => { draggingRef.current = true; setLocal(v); }}
                    // One emit per interaction instead of one per mousemove. Fires for a drag
                    // release, a click on the track, and an arrow-key press alike.
                    onChangeCommitted={(event, v) => commit(v)}
                />
            </div>
        </div>
    );
}

// lobby hook
function Lobby() {
    const profile = useRecoilValue(PROFILE);
    const username = profile['username'];
    const [lobbyCode, setLobbyCode] = useRecoilState(LOBBY_CODE);
    const socket = useRecoilValue(SOCKET);
    const setPlayScreen = useSetRecoilState(PLAY_SCREEN);
    const setScreen = useSetRecoilState(SCREEN);
    const authtoken = useRecoilValue(AUTHTOKEN);
    const [lobbyScreen, setLobbyScreen] = useState("inlobby");
    const [recoilGameSettings, setRecoilGameSettings] = useRecoilState(GAMESETTINGS);

    const initialGameSettings = clone(recoilGameSettings);
    console.log(recoilGameSettings);
    
    // Game settings
    const [gameSettings, setGameSettings] = useReducer(
        (state, newState) => ({...state, ...newState}),
        initialGameSettings
    );

    // Copy game settings over to the recoil value
    useEffect(() => {
        setRecoilGameSettings(gameSettings);
        // eslint-disable-next-line
    }, [gameSettings]);

    // console.log(gameSettings);
    useEffect(() => {
        const lobbyStateListener = (data) => {
            setGameSettings({
                'players': data['players'],
                'teams': data['teams'],
                'max_players': data['max_players'],
                'rounds': data['rounds'],
                'questions_num': data['questions_num'],
                'gap_time': data['gap_time'],
                'post_buzz_time': data['post_buzz_time'],
            });
            setLobbyCode(data['code']);
        };

        const gameStartedListener = (data) => {
            setScreen(6);
            setLobbyScreen("inlobby");
        };

        const closeLobbyListener = (data) => {
            setPlayScreen("home");
        }

        const startGameFailedListener = (data) => {
            setPlayScreen("home");
        }

        const lobbyLoadingListener = (data) => {
            setLobbyScreen("loading");
        }

        socket.on("lobbystate", lobbyStateListener);
        socket.on("gamestarted", gameStartedListener);
        socket.on("closelobby", closeLobbyListener);
        socket.on("startgamefailed", startGameFailedListener);
        socket.on("lobbyloading", lobbyLoadingListener);


        return function cleanSockets() {
            socket.off("lobbystate", lobbyStateListener);
            socket.off("gamestarted", gameStartedListener);
            socket.off("closelobby", closeLobbyListener);
            socket.off("startgamefailed", startGameFailedListener);
            socket.off("lobbyloading", lobbyLoadingListener);
        }
        // Registered once per socket. This effect previously had NO dependency array, so all five
        // handlers were torn down and re-attached on every render — and a slider drag re-renders
        // this component on every mousemove, so a single drag churned through hundreds of
        // register/unregister cycles. Same bug, same fix, as the Game.jsx socket effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket]);
    

    function leave() {
        socket.emit("leavelobby", {
            auth: authtoken
        });
        setPlayScreen("home");
    }

    function start() {
        socket.emit("startgame", {
            auth: authtoken
        });
        socket.emit("lobbyloading", {
            auth: authtoken
        })
    }

    //emits update to settings and the socket will emit settings back
    function updateSettings(updatedSettings) {
        socket.emit("updatesettings", {
            auth: authtoken,
            settings: updatedSettings,
        });
    }

    useVoiceCommands('lobby', [
        {
            id: 'lobby.start',
            label: 'Start game',
            phrases: ['start game', 'start the game', 'begin game', 'lets play', 'start'],
            run: start,
        },
        {
            id: 'lobby.leave',
            // Confirmed: leaving drops everyone's lobby state, and a misheard "quit" mid-setup
            // would be maddening. The server no-ops a leave if you aren't in a lobby (main.py),
            // but the local playScreen change is still disruptive.
            label: 'Leave lobby',
            phrases: ['leave lobby', 'quit lobby', 'leave the lobby', 'quit'],
            run: leave,
            confirm: true,
        },
        {
            id: 'lobby.teams2',
            label: 'Two teams',
            phrases: ['two teams', 'teams on', 'enable teams'],
            run: () => updateSettings({ teams: 2 }),
        },
        {
            id: 'lobby.teams0',
            label: 'No teams',
            phrases: ['no teams', 'teams off', 'free for all'],
            run: () => updateSettings({ teams: 0 }),
        },
    ]);

    if(lobbyScreen === "inlobby") {
        return (
            <div class="lobby-wrapper">
                <div class="lobby-gamesettings-wrapper">
                    <div class="lobby-title">
                        Game Settings (Custom)
                    </div>
                    <div class="lobby-gamesettings-list-wrapper">
                        <div class="lobby-gamesettings-setting-wrapper">
                            <div>Max players</div>
                            <div>{gameSettings['max_players']}</div>
                        </div>
                        <div class="lobby-gamesettings-setting-wrapper">
                            <div>Teams</div>
                            <div class="lobby-gamesettings-hor-flex">
                                <div onClick={() => {
                                    updateSettings({'teams': 0});
                                }} className={"lobby-gamesettings-selector-item " + (gameSettings['teams'] === 0 ? "lobby-gamesettings-selector-selected" : "")}>
                                    None (FFA)
                                </div>
                                <div onClick={() => {
                                    updateSettings({'teams': 2});
                                }} className={"lobby-gamesettings-selector-item " + (gameSettings['teams'] === 2 ? "lobby-gamesettings-selector-selected" : "")}>
                                    2
                                </div>
                            </div>
                        </div>
                        <div class="lobby-gamesettings-setting-wrapper">
                            <div>Rounds</div>
                            <div>{gameSettings['rounds']}</div>
    
                            {/* <div class="lobby-gamesettings-hor-flex">
                                <div class="lobby-gamesettings-slider-wrapper">
                                    <Slider
                                        defaultValue={gameSettings['rounds']}
                                        valueLabelDisplay="auto"
                                        step={2}
                                        marks
                                        min={1}
                                        max={7}
                                        value={gameSettings['rounds']}
                                        onChange={(event, value) => {
                                            updateSettings({'rounds': value});
                                        }}
                                        classes={"lobby-gamesettings-slider-wrapper"}
                                    />
                                </div>
                            </div> */}
                        </div>
                        <div class="lobby-gamesettings-setting-wrapper">
                            <div>Questions per round</div>
                            <SettingSlider
                                step={1}
                                min={1}
                                max={20}
                                value={gameSettings['questions_num']}
                                onCommit={(value) => updateSettings({'questions_num': value})}
                            />
                        </div>
                        <div class="lobby-gamesettings-setting-wrapper">
                            <div>Time between questions (s)</div>
                            <SettingSlider
                                step={1}
                                min={0}
                                max={30}
                                value={gameSettings['gap_time']}
                                onCommit={(value) => updateSettings({'gap_time': value})}
                            />
                        </div>
                        <div class="lobby-gamesettings-setting-wrapper">
                            <div>Buzz time after questions (s)</div>
                            <SettingSlider
                                step={1}
                                min={0}
                                max={10}
                                value={gameSettings['post_buzz_time']}
                                onCommit={(value) => updateSettings({'post_buzz_time': value})}
                            />
                        </div>
                    </div>
                    <div class="lobby-gamesettings-buttons-wrapper">
                        <div class="lobby-gamesettings-button" onClick={start}>
                            START
                        </div>
                        <div class="lobby-gamesettings-button" onClick={leave}>
                            QUIT
                        </div>
                    </div>
                </div>
                <div class="lobby-players-wrapper">
                    <div class="lobby-title">
                        <div>
                            Players {typeof gameSettings['players'][0] === 'string' ? gameSettings['players'].length : gameSettings['players'][0].length + gameSettings['players'][1].length}/{gameSettings['max_players']}
                        </div>
                        <div>
                            Lobby: {lobbyCode}
                        </div>
                    </div>
                    {typeof gameSettings['players'][0] === 'string' &&
                        <div class="lobby-players-list-wrapper">
                            {gameSettings['players'].map((uname) =>
                                <Player name={uname} self={uname===username} key={uname} switchable={false}/>
                            )}
                        </div>
                    }
                    {typeof gameSettings['players'][0] === 'object' &&
                        <div class="lobby-players-list-wrapper">
                            <div class="lobby-players-list-team-wrapper">
                                <div class="lobby-players-list-team-title">
                                    Team 1
                                </div>
                                {gameSettings['players'][0].map((uname) =>
                                    <Player name={uname} self={uname===username} key={uname} switchable={true}/>
                                )}
                            </div>
                            <div class="lobby-players-list-team-wrapper">
                                <div class="lobby-players-list-team-title">
                                    Team 2
                                </div>
                                {gameSettings['players'][1].map((uname) =>
                                    <Player name={uname} self={uname===username} key={uname} switchable={true}/>
                                )}
                            </div>
                        </div>
                    }
                    
                </div>
            </div>
        );
    } else {
        return (
            <div class="lobby-loading-wrapper">
                Loading game, please wait...
            </div>
        );
    }
    
}

export default Lobby;