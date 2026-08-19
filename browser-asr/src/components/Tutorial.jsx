import '../styles/Tutorial.css';
import { useState } from "react";
import { SCREEN, PREVSCREEN, INTERFACE_NAME } from '../store';
import { useVoiceCommands } from '../voice/registry';
import { useRecoilValue, useSetRecoilState } from "recoil";
import Tutorial1 from '../assets/Tutorial1.png';
import Tutorial2 from '../assets/Tutorial2.png';
import Tutorial3 from '../assets/Tutorial3.png';
import Tutorial4 from '../assets/Tutorial4.png';
import Tutorial5 from '../assets/Tutorial5.png';
import Tutorial6 from '../assets/Tutorial6.png';
import Tutorial7 from '../assets/Tutorial7.png';
import Tutorial8 from '../assets/Tutorial8.png';
import Tutorial9 from '../assets/Tutorial9.png';
import Tutorial10 from '../assets/Tutorial1.png';

function Tutorial() {
    const [page, setPage] = useState(0);
    const setScreen = useSetRecoilState(SCREEN);
    const prevScreen = useRecoilValue(PREVSCREEN);
    const interface_name = useRecoilValue(INTERFACE_NAME);
    var tutorialItems = [
        {
            img: Tutorial1,
            text: "Welcome to the tutorial! In this tutorial, we'll be introducing you to our game interface."
        },
        {
            img: Tutorial2,
            text: "The 'Play' tab is the hub for playing " + interface_name + ". Let's go there first!"
        },
        {
            img: Tutorial3,
            text: "For this tutorial, let's start a lobby. Note you can only be in one lobby or game at a time (including active games that you have left)!"
        },
        {
            img: Tutorial4,
            text: "Every custom game has game settings you can adjust, and a gamecode so you can play with friends. For now, only 1 round of gameplay is supported. When, you're ready, click start."
        },
        {
            img: Tutorial5,
            text: "A question will be read out loud and its transcript will begin playing in the textbox."
        },
        {
            img: Tutorial6,
            text: "When you think you know the answer, click the buzz button, type your answer into the answer box, and hit submit. If it's correct, the lobby will skip to the next question. If it's wrong, the question will continue to play."
        },
        {
            img: Tutorial7,
            text: "Answers are autograded; correct answers will get you 10 points, incorrect answers will lose you 5."
        },
        {
            img: Tutorial8,
            text: "You can also enable voice commands with the voice commands switch."
        },
        {
            img: Tutorial9,
            text: "When enabled, say 'go' into your microphone to buzz in, and 'stop' for the speech-to-text algorithm to output what you said into the answer box."
        },
        {
            img: Tutorial10,
            text: "That's all for the tutorial! Good luck, and have fun!"
        }
    ]

    useVoiceCommands('tutorial', [
        { id: 'tutorial.next', label: 'Next page', phrases: ['next page', 'next'], run: () => setPage((page + 1) % tutorialItems.length) },
        { id: 'tutorial.prev', label: 'Previous page', phrases: ['previous page', 'previous', 'go back', 'back'], run: () => setPage((page - 1 + tutorialItems.length) % tutorialItems.length) },
        { id: 'tutorial.exit', label: 'Exit tutorial', phrases: ['exit tutorial', 'close tutorial', 'exit'], run: () => setScreen(prevScreen) },
    ]);

    function TutorialBtns(props) {
        return (
            <div class="tutorial-footer-btns-wrapper">
                <div class="tutorial-footer-btns-page">
                    Page {page+1} / {tutorialItems.length}
                </div>
                <div class="tutorial-footer-btns-btn-wrapper">
                    <div class="tutorial-footer-btns-btn" onClick={() => {
                        setPage((page-1+tutorialItems.length)%tutorialItems.length);
                    }}>
                        Prev
                    </div>
                    <div class="tutorial-footer-btns-btn" onClick={() => {
                        setPage((page+1)%tutorialItems.length);
                    }}>
                        Next
                    </div>
                </div>
                <div class="tutorial-footer-btns-exit" onClick={() => {
                    setScreen(prevScreen);
                }}>
                    Exit
                </div>
            </div>
        )
    }

    return (
        <div class="tutorial-wrapper">
            <div class="tutorial-img-wrapper">
                <img src={tutorialItems[page].img} alt="tutorial" class="tutorial-img"/>
            </div>
            <div class="tutorial-img-divider"></div>
            <div class="tutorial-footer-wrapper">
                <TutorialBtns/>
                <div class="tutorial-footer-divider"></div>
                <div class="tutorial-footer-text">
                    {tutorialItems[page].text}
                </div>
            </div>
        </div>
    );
}

export default Tutorial;