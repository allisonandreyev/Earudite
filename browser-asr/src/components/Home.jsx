import "../styles/Home.css";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { SCREEN, PLAY_SCREEN, INTERFACE_NAME } from "../store";

import MicIcon from '@material-ui/icons/Mic';
import SportsEsportsIcon from '@material-ui/icons/SportsEsports';

// Landing screen after login. Deliberately just the two things people come here to do — first-time
// users were lost in the old sidenav of seven destinations. Everything else (leaderboards, profile,
// settings) is reachable from inside Play or from the account icons along the bottom.
function Home(props) {
    const setScreen = useSetRecoilState(SCREEN);
    const setPlayScreen = useSetRecoilState(PLAY_SCREEN);
    const interface_name = useRecoilValue(INTERFACE_NAME);

    return (
        <div class="home-content-wrapper">
            <div class="home-title">{interface_name}</div>
            <div class="home-subtitle"><b>the</b> quiz game</div>
            <div class="home-choices-wrapper">
                <div class="home-choice-btn" onClick={() => {setScreen(4); document.location.hash = "record";}}>
                    <MicIcon className="home-choice-icon"/>
                    <div class="home-choice-label">Record a question</div>
                    <div class="home-choice-caption">Read a question aloud for others to play</div>
                </div>
                <div class="home-choice-btn" onClick={() => {setPlayScreen("home"); setScreen(3); document.location.hash = "play";}}>
                    <SportsEsportsIcon className="home-choice-icon"/>
                    <div class="home-choice-label">Play a question</div>
                    <div class="home-choice-caption">Buzz in and answer with your voice</div>
                </div>
            </div>
            {props.footer}
        </div>
    );
}

export default Home;
