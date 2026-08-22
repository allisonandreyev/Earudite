import "../styles/Shop.css";
import { useEffect, useState } from "react";
import { useAlert } from 'react-alert';
// import CoinIcon from '../assets/coin_transparent.png';
import 'react-tippy/dist/tippy.css';
import axios from 'axios';
import { useRecoilState, useRecoilValue } from "recoil";
import { TRANSCRIPTS, URLS, MODEL_PREFERENCES } from "../store";
import { useVoiceCommands } from "../voice/registry";
import { QUESTION_CATEGORIES, ANY_CATEGORY_ID } from "../questionCategories";
import AudioRecorder from './AudioRecorder.jsx';



//ASSETS
import LoopIcon from '@material-ui/icons/Loop';

// displays bounty in coins for a single task
// function Taskbounty(props) {
//     return (
//         <div class="shop-taskbounty-wrapper">
//             Bounty: 
//             <img class="shop-taskbounty-coin-icon" src={CoinIcon} alt="Coins: "/>
//             {props.bounty}
//         </div>
//     );
// }


// coming soon card under the spending section
// function SpendComingSoon() {
//     return (
//         <div class="shop-spend-comingsoon-wrapper">
//             Coming Soon!
//         </div>
//     );
// }

// hook for displaying transcript options
function TranscriptOption(props) {

    function handleRecord() {
        props.setTranscript(props.transcript);
        props.setAudios(Array.apply(null, Array(props.transcript['tokenizations'].length)).map(function () {return undefined}));
        props.setShopScreen("recording");
    }

    return (
        <div class="shop-selectingtranscript-transcript-wrapper">
            <div class="shop-selectingtranscript-transcript-body-wrapper">
                <div class="shop-selectingtranscript-transcript-body">
                    {props.transcript['transcript']}
                </div>
            </div>
            <div class="shop-selectingtranscript-transcript-footer">
                <div class="shop-selectingtranscript-pool-badge">
                    {props.transcript['recorded'] ? "Re-recording" : "New question"}
                </div>

                <div onClick={handleRecord} class="shop-selectingtranscript-record-btn">
                    Record &#187;
                </div>
            </div>
        </div>
    );
}

// hook that formats recording into sentence by sentence
function Sentence(props) {
    return (
        <div class="shop-sentence-wrapper">
            <div class="shop-sentence-transcript-wrapper">
                {props.transcript}
            </div>
            <AudioRecorder setAudio={props.setAudio} index={props.index}/>
        </div>
    );
}

// hook for the shop
function Shop() {
    const [shopScreen, setShopScreen] = useState("home");
    const [difficulty, setDifficulty] = useState("easy");
    const [category, setCategory] = useState(ANY_CATEGORY_ID);
    const [transcripts, setTranscripts] = useRecoilState(TRANSCRIPTS);
    const alert = useAlert()
    const [transcript, setTranscript] = useState({"transcript": ""});
    const [audios, setAudios] = useState([]);
    const urls = useRecoilValue(URLS);
    const modelPreferences = useRecoilValue(MODEL_PREFERENCES);

    function setAudio(index, audio) {
        let audiosCopy = [...audios];
        audiosCopy[index] = audio;
        setAudios(audiosCopy);
        console.log(audios);
    }

    function activateShopScreen(diff) {
        setDifficulty(diff);
        setShopScreen("selectingtranscript");
    }

    function rerollTranscripts() {
        const prevScreen = (' ' + shopScreen).slice(1);;
        setShopScreen("loading");
        const categoryParam = category === ANY_CATEGORY_ID ? "" : `&category=${encodeURIComponent(category)}`;
        // Flip once per batch (not per candidate): this whole set of transcripts is either all
        // re-recordings of existing questions (more readings/statistics on a question) or all
        // brand-new questions (coverage). Roughly 50/50.
        const poolParam = `&pool=${Math.random() < 0.5 ? "recorded" : "unrecorded"}`;
        let transcriptsArray = [[],[],[]];
        let requestsArray = [];
        for(let i = 0; i < 4; i++) {
            requestsArray.push(axios.get(urls['dataflow'] + '/question/unrec?difficultyType=0' + categoryParam + poolParam)
                .then(function (response) {
                    transcriptsArray[0].push(response['data']['results'][0]);
                }));
        }
        for(let i = 0; i < 4; i++) {
            requestsArray.push(axios.get(urls['dataflow'] + '/question/unrec?difficultyType=1' + categoryParam + poolParam)
                .then(function (response) {
                    transcriptsArray[1].push(response['data']['results'][0]);
                }));
        }
        for(let i = 0; i < 4; i++) {
            requestsArray.push(axios.get(urls['dataflow'] + '/question/unrec?difficultyType=2' + categoryParam + poolParam)
                .then(function (response) {
                    transcriptsArray[2].push(response['data']['results'][0]);
                }));
        }
        axios.all(requestsArray)
            .then(() => {
                setTranscripts(transcriptsArray);
                setShopScreen(prevScreen);
            })
            .catch(function (error) {
                alert.error("Rerolling failed");
                setShopScreen(prevScreen);
            });
    }

    useEffect(() => {
        rerollTranscripts();
        // eslint-disable-next-line
    }, []);

    function submitAudios() {
        let b = true;
        audios.forEach(element => {
            if(element == null && b) {
                alert.error("Please record all sentences before submitting");
                b = false;
            }
        });

        if(b) submitAudios2();
    }

    // Voice commands for the recording flow. The list is rebuilt per sub-screen rather than
    // guarded, because the registry scopes commands by mount: "reroll" simply does not exist
    // unless the transcript picker is showing, so it can't fire from the difficulty screen.
    const voiceCommands = [];
    if (shopScreen === 'home') {
        voiceCommands.push(
            { id: 'shop.easy', label: 'Easy', phrases: ['easy', 'easy questions'], run: () => activateShopScreen('easy') },
            { id: 'shop.medium', label: 'Medium', phrases: ['medium', 'medium questions'], run: () => activateShopScreen('medium') },
            { id: 'shop.hard', label: 'Hard', phrases: ['hard', 'hard questions'], run: () => activateShopScreen('hard') },
        );
        QUESTION_CATEGORIES.forEach((c) => {
            voiceCommands.push({
                id: 'shop.cat.' + c.id,
                label: 'Category: ' + c.label,
                phrases: ['category ' + c.label.toLowerCase(), c.label.toLowerCase() + ' category'],
                run: () => setCategory(c.id),
            });
        });
    } else if (shopScreen === 'selectingtranscript') {
        voiceCommands.push(
            // "refresh" is what the circular-arrow icon reads as to most people; the button's only
            // name is aria-label="Reroll", so without these the word matched nothing at all here.
            { id: 'shop.reroll', label: 'Reroll', phrases: ['reroll', 'refresh', 'reload', 'shuffle', 'update', 'different questions', 'new questions'], run: rerollTranscripts },
            { id: 'shop.back', label: 'Back', phrases: ['go back', 'back', 'cancel'], run: () => setShopScreen('home') },
        );
    } else if (shopScreen === 'recording') {
        voiceCommands.push(
            // Confirmed: submitting uploads every recorded sentence and ends the session, and it
            // cannot be undone from the UI.
            { id: 'shop.submit', label: 'Submit recording', phrases: ['submit recording', 'submit recordings', 'upload recording', 'done recording'], run: submitAudios, confirm: true },
            { id: 'shop.backToPick', label: 'Back', phrases: ['go back', 'back', 'cancel'], run: () => setShopScreen('selectingtranscript') },
        );
    }
    useVoiceCommands('shop', voiceCommands);

    async function submitAudios2() {
        setShopScreen("submitting");
        const formdata = new FormData();
        const qb_ids = Array.apply(null, Array(audios.length)).map(function () { return transcript.id; });
        const recTypes = Array.apply(null, Array(audios.length)).map(function () { return "normal"; });
        const sentenceIds = Array.apply(null, Array(audios.length)).map(function (x, i) { return i; });
        const diarMetadatas = Array.apply(null, Array(audios.length)).map(function () { return ""; });
        // Not transcribed live — tagged so a future accuracy pipeline can find these by model.
        const preferredModels = Array.apply(null, Array(audios.length)).map(function () { return modelPreferences.questionModel; });
        audios.forEach((element) => {
            formdata.append("audio", element);
        });
        qb_ids.forEach((element) => {
            formdata.append("qb_id", element);
        });
        recTypes.forEach((element) => {
            formdata.append("recType", element);
        });
        preferredModels.forEach((element) => {
            formdata.append("preferredModel", element);
        });
        if(transcript.hasOwnProperty('sentenceId')) {
            sentenceIds.forEach((element) => {
                formdata.append("sentenceId", element);
            }); 
        }
        diarMetadatas.forEach((element) => {
            formdata.append("diarMetadata", element);
        });
        const config = {
            headers: { 'content-type': 'multipart/form-data' }
        }
        await axios.post(urls['dataflow'] + "/audio", formdata, config)
            .then(() => {
                setShopScreen("home");
                alert.success("Submitted recording");
            })
            .catch(() => {
                setShopScreen("home");
                alert.error("Submission failed");
            });
        
      };

    if(shopScreen === "home") {
        return (
            <div class="shop-content-wrapper">
                {/* <div class="shop-title">Spend</div>
                <div class="shop-title-divider"></div>
                <div class="shop-spend-wrapper">
                    <SpendComingSoon/>
                    <SpendComingSoon/>
                    <SpendComingSoon/>
                    <SpendComingSoon/>
                </div>
                <div class="shop-title">Earn</div>
                <div class="shop-title-divider"></div> */}
                <div class="shop-category-picker-wrapper">
                    <label class="shop-category-picker-label" for="shop-category-picker">
                        Question category
                    </label>
                    <select
                        id="shop-category-picker"
                        class="shop-category-picker-select"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                    >
                        {QUESTION_CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </select>
                </div>
                <div class="shop-earn-wrapper">
                    
                    <div onClick={() => {activateShopScreen("easy")}} class="shop-earn-selector-wrapper shop-earn-selector-hvr-grow shop-earn-selector-easy">
                        <div>
                            <div class="shop-earn-selector-task-title">
                                RECORD
                            </div>
                            <div class="shop-earn-selector-task-description">
                                Record an easy difficulty transcript
                            </div>
                        </div>
                        
                        {/* <Taskbounty bounty="10-30"/> */}
                    </div>
                    <div onClick={() => activateShopScreen("medium")} class="shop-earn-selector-wrapper shop-earn-selector-hvr-grow shop-earn-selector-medium">
                        <div>
                            <div class="shop-earn-selector-task-title">
                                RECORD
                            </div>
                            <div class="shop-earn-selector-task-description">
                                Record a medium difficulty transcript
                            </div>
                        </div>
                        
                        {/* <Taskbounty bounty="30-50"/> */}
                    </div>
                    <div onClick={() => activateShopScreen("hard")} class="shop-earn-selector-wrapper shop-earn-selector-hvr-grow shop-earn-selector-hard">
                        <div>
                            <div class="shop-earn-selector-task-title">
                                RECORD
                            </div>
                            <div class="shop-earn-selector-task-description">
                                Record a hard difficulty transcript
                            </div>
                        </div>
                        
                        {/* <Taskbounty bounty="50-100"/> */}
                    </div>
                </div>
            </div>
        );
    } else if(shopScreen === "selectingtranscript") {
        return (
            <div class="shop-content-wrapper">
                <div class="shop-selectingtranscript-title">
                    Select {difficulty==="easy" ? "an" : "a"} {difficulty} difficulty transcript to record
                </div>
                <div class="shop-selectingtranscript-layer-wrapper">
                    <TranscriptOption bounty={50} setShopScreen={setShopScreen} setTranscript={setTranscript} transcript={difficulty === "easy" ? transcripts[0][0] : (difficulty === "medium" ? transcripts[1][0] : transcripts[2][0])} setAudios={setAudios}/>
                    <TranscriptOption bounty={50} setShopScreen={setShopScreen} setTranscript={setTranscript} transcript={difficulty === "easy" ? transcripts[0][1] : (difficulty === "medium" ? transcripts[1][1] : transcripts[2][1])} setAudios={setAudios}/>
                </div>
                <div class="shop-selectingtranscript-layer-wrapper">
                    <TranscriptOption bounty={50} setShopScreen={setShopScreen} setTranscript={setTranscript} transcript={difficulty === "easy" ? transcripts[0][2] : (difficulty === "medium" ? transcripts[1][2] : transcripts[2][2])} setAudios={setAudios}/>
                    <TranscriptOption bounty={50} setShopScreen={setShopScreen} setTranscript={setTranscript} transcript={difficulty === "easy" ? transcripts[0][3] : (difficulty === "medium" ? transcripts[1][3] : transcripts[2][3])} setAudios={setAudios}/>
                </div>
                <div class="shop-selectingtranscript-footer-wrapper">
                    <div class="shop-selectingtranscript-placeholder"></div>
                    <div onClick={() => {setShopScreen("home")}} class="shop-selectingtranscript-cancel-btn">
                        Back
                    </div>
                    <div onClick={rerollTranscripts} aria-label="Reroll" title="Reroll" class="shop-selectingtranscript-reroll-btn shop-selectingtranscript-reroll-btn-hvr-rotate">
                        <LoopIcon style={{color: "white", height: "2.5rem"}}/>
                    </div>
                </div>
                
            </div>
        );
    } else if(shopScreen === "loading") {
        return (
            <div class="shop-content-wrapper">
                <div class="shop-selectingtranscript-loading-wrapper">
                    Loading, please wait...
                </div>
            </div>
        );
    }else if(shopScreen === "submitting") {
        return (
            <div class="shop-content-wrapper">
                <div class="shop-selectingtranscript-loading-wrapper">
                    Submitting, please wait...
                </div>
            </div>
        );
    } else if(shopScreen === "recording") {
        let sentences = [];
        transcript['tokenizations'].forEach(element => {
            sentences.push(transcript['transcript'].substring(element[0], element[1]));
        });
    
        return (
            <div class="shop-content-wrapper">
                
                <div class="shop-sentences-wrapper">
                    <div class="shop-recording-instructions">
                        <b>Instructions:</b> Read through the sentence before recording to ensure you are prepared to speak smoothly and consistently. All sentences must be recorded to submit, and upon submission they will pass through a pre-screening process.
                    </div>
                    {sentences.map((sentence, index) =>
                        <Sentence transcript={sentence} key={sentence} setAudio={setAudio} index={index}/>
                    )}
                    <div class="shop-sentences-btn-wrapper">
                        <div onClick={submitAudios} class="shop-sentences-submit">
                            Submit
                        </div>
                        <div onClick={() => {setShopScreen("selectingtranscript")}} class="shop-sentences-cancel">
                            Back
                        </div>
                    </div>
                </div>
            </div>
        );
    } else {
        return (
            <div>

            </div>
        );
    }
    
}

export default Shop;