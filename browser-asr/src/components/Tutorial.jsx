import '../styles/Tutorial.css';
import { useEffect, useRef, useState } from "react";
import { SCREEN, PREVSCREEN, INTERFACE_NAME } from '../store';
import { useVoiceCommands } from '../voice/registry';
import { useRecoilValue, useSetRecoilState } from "recoil";
import MicIcon from '@material-ui/icons/Mic';
import VolumeUpIcon from '@material-ui/icons/VolumeUp';
import CheckIcon from '@material-ui/icons/Check';

// localStorage key: set once a player has seen (or skipped) the demo, so the Play page only opens
// it by itself on their first visit.
export const TUTORIAL_SEEN_KEY = 'earudite_tutorial_seen';

export function markTutorialSeen() {
    try { window.localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch (e) { /* private mode */ }
}

export function tutorialSeen() {
    try { return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'; } catch (e) { return true; }
}

// One turn of the game, acted out in about 30 seconds. Each step drives the mock game card below
// it: `say` is what the player speaks, `typed` what has reached the answer box, and so on.
const STEPS = [
    {
        ms: 5000,
        title: "Listen to the question",
        text: "Each question is an audio clip plus a short prompt. Listen and work out the answer.",
        playing: true,
    },
    {
        ms: 6000,
        title: "Say “buzz” to buzz in",
        text: "As soon as you know it, say “buzz”. You can also press Space, click Buzz, or press the play/pause button on your earbuds.",
        say: "buzz",
        buzzed: true,
    },
    {
        ms: 6000,
        title: "Say your answer",
        text: "Speak your answer. It shows up in the answer box, and you can fix it by typing.",
        say: "beethoven",
        buzzed: true,
        typed: "beethoven",
    },
    {
        ms: 5000,
        title: "Say “submit”",
        text: "Say “submit”, press Enter, or press your earbuds' button again to lock it in.",
        say: "submit",
        buzzed: true,
        typed: "beethoven",
    },
    {
        ms: 5000,
        title: "Score points",
        text: "A right answer scores +10 points. A wrong one (or running out of time) costs 5, and the clip carries on for everyone else.",
        buzzed: true,
        typed: "beethoven",
        correct: true,
    },
    {
        ms: 4000,
        title: "You're ready",
        text: "Hit Quick Play to jump straight in, or Create Lobby to play with friends. Headphones help the mic hear you over the clip.",
        done: true,
    },
];
const TOTAL_MS = STEPS.reduce((n, s) => n + s.ms, 0);
const TICK_MS = 100;

function stepAt(elapsed) {
    let t = elapsed;
    for (let i = 0; i < STEPS.length; i++) {
        if (t < STEPS[i].ms) return [i, t / STEPS[i].ms];
        t -= STEPS[i].ms;
    }
    return [STEPS.length - 1, 1];
}

function startOf(index) {
    return STEPS.slice(0, index).reduce((n, s) => n + s.ms, 0);
}

function MockGame({ step, frac }) {
    // The answer appears letter by letter while it is being "spoken".
    const typed = step.typed
        ? (step.say === step.typed ? step.typed.slice(0, Math.ceil(step.typed.length * Math.min(1, frac * 1.6))) : step.typed)
        : "";
    return (
        <div className="tutorial-mock">
            <div className="tutorial-mock-top">
                <span>Question 1 of 5</span>
                <span className="tutorial-mock-score">{step.correct ? "10" : "0"} pts</span>
            </div>
            <div className="tutorial-mock-prompt">
                <div className={"tutorial-mock-wave " + (step.playing ? "tutorial-mock-wave-on" : "")}>
                    {Array.from({ length: 14 }).map((_, i) => <span key={i} style={{ animationDelay: `${(i % 7) * 0.09}s` }} />)}
                </div>
                <div className="tutorial-mock-prompt-text">
                    <VolumeUpIcon style={{ fontSize: "1.1rem", verticalAlign: "middle", marginRight: "0.3rem" }} />
                    Name the composer of this piece.
                </div>
            </div>
            <div className="tutorial-mock-answer-row">
                <div className={"tutorial-mock-buzz " + (step.buzzed ? "tutorial-mock-buzz-on" : "")}>
                    {step.buzzed ? "BUZZED" : "BUZZ"}
                </div>
                <div className={"tutorial-mock-answer " + (step.buzzed ? "tutorial-mock-answer-on" : "")}>
                    {typed || <span className="tutorial-mock-placeholder">{step.buzzed ? "Speak your answer…" : "Buzz in first"}</span>}
                </div>
            </div>
            <div className="tutorial-mock-footer">
                {step.say && (
                    <div className="tutorial-mock-say" key={step.say}>
                        <MicIcon style={{ fontSize: "1.1rem" }} /> “{step.say}”
                    </div>
                )}
                {step.correct && (
                    <div className="tutorial-mock-correct">
                        <CheckIcon style={{ fontSize: "1.1rem" }} /> Correct! +10
                    </div>
                )}
            </div>
        </div>
    );
}

// The animated demo. `onClose` makes it an overlay (Play page); without it, it is the full
// Tutorial screen and Exit returns to wherever the player came from.
function Tutorial({ onClose }) {
    const [elapsed, setElapsed] = useState(0);
    const [paused, setPaused] = useState(false);
    const setScreen = useSetRecoilState(SCREEN);
    const prevScreen = useRecoilValue(PREVSCREEN);
    const interfaceName = useRecoilValue(INTERFACE_NAME);
    const timerRef = useRef(null);

    useEffect(() => {
        if (paused) return undefined;
        timerRef.current = setInterval(() => {
            setElapsed((e) => Math.min(TOTAL_MS, e + TICK_MS));
        }, TICK_MS);
        return () => clearInterval(timerRef.current);
    }, [paused]);

    const finished = elapsed >= TOTAL_MS;
    const [index, frac] = stepAt(elapsed);
    const step = STEPS[index];

    function exit() {
        markTutorialSeen();
        if (onClose) onClose();
        else setScreen(prevScreen);
    }
    function go(i) {
        setElapsed(startOf(Math.max(0, Math.min(STEPS.length - 1, i))));
    }
    function replay() {
        setElapsed(0);
        setPaused(false);
    }

    useVoiceCommands('tutorial', [
        { id: 'tutorial.next', label: 'Next step', phrases: ['next step', 'next'], run: () => go(index + 1) },
        { id: 'tutorial.prev', label: 'Previous step', phrases: ['previous step', 'previous', 'go back', 'back'], run: () => go(index - 1) },
        { id: 'tutorial.replay', label: 'Replay tutorial', phrases: ['replay', 'watch again', 'restart'], run: replay },
        { id: 'tutorial.exit', label: 'Close tutorial', phrases: ['close tutorial', 'exit tutorial', 'skip tutorial', 'done', 'exit'], run: exit },
    ]);

    const body = (
        <div className="tutorial-wrapper">
            <div className="tutorial-header">
                <div className="tutorial-heading">How to play {interfaceName}</div>
                <div className="tutorial-close" onClick={exit} title="Close">{finished ? "Done" : "Skip"}</div>
            </div>
            <div className="tutorial-progress">
                {STEPS.map((s, i) => (
                    <div key={i} className="tutorial-progress-seg" onClick={() => go(i)} title={s.title}>
                        <div className="tutorial-progress-fill" style={{ width: `${i < index ? 100 : i === index ? Math.round(frac * 100) : 0}%` }} />
                    </div>
                ))}
            </div>
            <MockGame step={step} frac={frac} />
            <div className="tutorial-caption">
                <div className="tutorial-caption-title">{index + 1}. {step.title}</div>
                <div className="tutorial-caption-text">{step.text}</div>
            </div>
            <div className="tutorial-controls">
                <div className="tutorial-btn" onClick={() => go(index - 1)}>Back</div>
                {finished
                    ? <div className="tutorial-btn" onClick={replay}>Watch again</div>
                    : <div className="tutorial-btn" onClick={() => setPaused((p) => !p)}>{paused ? "Play" : "Pause"}</div>}
                {finished
                    ? <div className="tutorial-btn tutorial-btn-primary" onClick={exit}>Let's play</div>
                    : <div className="tutorial-btn" onClick={() => go(index + 1)}>Next</div>}
            </div>
        </div>
    );

    if (!onClose) return body;
    return (
        <div className="tutorial-overlay" onClick={(e) => { if (e.target === e.currentTarget) exit(); }}>
            <div className="tutorial-overlay-card">{body}</div>
        </div>
    );
}

export default Tutorial;
