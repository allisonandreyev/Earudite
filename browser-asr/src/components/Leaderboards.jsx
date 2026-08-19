import "../styles/Leaderboards.css";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRecoilValue } from "recoil";
import {
    Tooltip,
} from 'react-tippy';
import {
    URLS,
    PROFILE
} from "../store";
import { useAlert } from 'react-alert';
import axios from 'axios';
import LeaderboardMenu from './LeaderboardMenu.jsx';

// ASSETS
// import EmojiEventsIcon from '@material-ui/icons/EmojiEvents';
import LoopIcon from '@material-ui/icons/Loop';
import ArchiveIcon from '@material-ui/icons/Archive';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';


// single user card
function User(props) {
    return (
        <div class="leaderboards-board-user-wrapper">
            <div class="leaderboards-board-user-rank">
                {props.rank}
            </div>
            <div class="leaderboards-board-user-name">
                {props.username}
            </div>
            <div class="leaderboards-board-user-rating">
                <Tooltip
                    // options
                    title="Score"
                    position="top"
                    trigger="mouseenter"
                    unmountHTMLWhenHide="true"
                >
                    {props.rating}
                </Tooltip>
            </div>
        </div>
    );
}


// topic card
function Topic(props) {
    return (
        <div className={"leaderboards-topic-wrapper" + (props.topic === props.self ? " leaderboards-topic-wrapper-selected" : "")}
            onClick={() => { props.setTopic(props.self) }}
        >
            <div class="leaderboards-topic-name">
                {props.name}
            </div>


            <div>
                {props.rank <= 0 &&
                    <Tooltip
                        // options
                        title="Not on leaderboard"
                        position="top"
                        trigger="mouseenter"
                        unmountHTMLWhenHide="true"
                    >
                        --
                    </Tooltip>
                }
                {props.rank > 0 &&
                    <Tooltip
                        // options
                        title="Your rank"
                        position="top"
                        trigger="mouseenter"
                        unmountHTMLWhenHide="true"
                    >
                        #{props.rank}
                    </Tooltip>
                }

            </div>
        </div>
    )
}

//leaderboards hook
function Leaderboards() {
    const urls = useRecoilValue(URLS);
    const profile = useRecoilValue(PROFILE);
    const alert = useAlert();

    const [topic, setTopic] = useState("all");
    const [screen, setScreen] = useState("loading");
    const [selectedYear, setSelectedYear] = useState(null);
    const [selectedMonth, setSelectedMonth] = useState(null);

    const [archiveSummary, setArchiveSummary] = useState([]);

    // Score leaderboards
    const [leaderboards, setLeaderboards] = useState([]);
    const [leaderboardEmpty, setLeaderboardEmpty] = useState(false);
    const [rank, setRank] = useState(-1);

    // Recording leaderboards
    const [recordingLeaderboards, setRecordingLeaderboards] = useState([]);
    const [recordingEmpty, setRecordingEmpty] = useState(false);
    const [recordingRank, setRecordingRank] = useState(-1);
    
    // Get current month
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];

    const screenRef = useRef(screen);
    screenRef.current = screen;
    const updateLeaderboards = useCallback(() => {
        const TO = setTimeout(() => {
            if (screenRef.current === "loading") {
                setScreen("home");
                setSelectedMonth(null);
                setSelectedYear(null);
                alert.error("Failed to get leaderboards");
            }
        }, 5000);
    
        if(topic === "all") {
            setScreen("loading");

            let gameplayUrl = urls['dataflow'] + '/leaderboard';
            if (selectedMonth && selectedYear) {
                gameplayUrl += '/archive/' + selectedYear + '/' + selectedMonth;
            }

            axios.get(gameplayUrl)
                .then(function (response) {
                    setLeaderboards(response.data.results);
                    setScreen("home");
                    clearTimeout(TO);
    
                    let rank1 = -1;
                    for(let i = 0; i < response.data.results.length; i++) {
                        if(response.data.results[i].userId === profile._id) {
                            rank1 = i;
                        }
                    }
                    setRank(rank1+1);
                })
                .catch(function () {
                    // No data for this view (e.g. missing monthly archive) — show empty, not "Failed"
                    setLeaderboards([]);
                    setScreen("home");
                    clearTimeout(TO);
                });
        } else if(topic === "recording") {
            setScreen("loading");

            let audioUrl = urls['dataflow'] + '/leaderboard/audio';
            if (selectedMonth && selectedYear) {
                audioUrl += '/archive/' + selectedYear + '/' + selectedMonth;
            }

            axios.get(audioUrl)
                .then(function (response) {
                    setRecordingLeaderboards(response.data.results);
                    setScreen("home");
                    clearTimeout(TO);
    
                    let rank1 = -1;
                    for(let i = 0; i < response.data.results.length; i++) {
                        if(response.data.results[i].userId === profile._id) {
                            rank1 = i;
                        }
                    }
                    setRecordingRank(rank1+1);
                })
                .catch(function () {
                    // No data for this view (e.g. missing monthly archive) — show empty, not "Failed"
                    setRecordingLeaderboards([]);
                    setScreen("home");
                    clearTimeout(TO);
                });
        }
    }, [alert, profile._id, topic, urls, selectedMonth, selectedYear]);

    useEffect(() => {
        const TO = setTimeout(() => {
            if (screenRef.current === "loading") {
                setScreen("home");
                alert.error("Failed to get leaderboards");
            }
        }, 5000);

        setScreen("loading");

        let gameplayUrl = urls['dataflow'] + '/leaderboard';
        let audioUrl = urls['dataflow'] + '/leaderboard/audio';
        if (selectedMonth && selectedYear) {
            gameplayUrl += '/archive/' + selectedYear + '/' + selectedMonth;
            audioUrl += '/archive/' + selectedYear + '/' + selectedMonth;
        }
        const gameplayLeaderboard = axios.get(gameplayUrl)
            .then(function (response) {
                setLeaderboards(response.data.results);

                let rank1 = -1;
                for(let i = 0; i < response.data.results.length; i++) {
                    if(response.data.results[i].userId === profile._id) {
                        rank1 = i;
                    }
                }
                setRank(rank1+1);
            })
            .catch(function () { setLeaderboards([]); });
        const audioLeaderboard = axios.get(audioUrl)
            .then(function (response) {
                setRecordingLeaderboards(response.data.results);

                let rank1 = -1;
                for(let i = 0; i < response.data.results.length; i++) {
                    if(response.data.results[i].userId === profile._id) {
                        rank1 = i;
                    }
                }
                setRecordingRank(rank1+1);
            })
            .catch(function () { setRecordingLeaderboards([]); });

        const archiveSummaryPromise = axios.get(urls['dataflow'] + '/leaderboard/archive/summary')
            .then(function (response) {
                setArchiveSummary(response.data.summary);
            })
            .catch(function () {});

        // .finally so a failed/empty request still resolves the screen instead of the 5s "Failed" timeout
        Promise.all([gameplayLeaderboard, audioLeaderboard, archiveSummaryPromise]).finally(() => {
            setScreen("home");
            clearTimeout(TO);
        });
    }, [alert, profile._id, urls, selectedMonth, selectedYear]);

    useEffect(() => {
        updateLeaderboards();
    }, [topic, updateLeaderboards]);

    useEffect(() => {
        setRecordingEmpty(recordingLeaderboards.length === 0);
    }, [recordingLeaderboards]);

    useEffect(() => {
        setLeaderboardEmpty(leaderboards.length === 0);
    }, [leaderboards]);

    if (screen === "home") {
        const leaderboardArr = []; // rank, username, points
        const recordingLeaderboardArr = [];

        for(let i = 0; i < leaderboards.length; i++) {
            leaderboardArr.push([i+1, leaderboards[i].username, leaderboards[i].score]);
        }
        for(let i = 0; i < recordingLeaderboards.length; i++) {
            recordingLeaderboardArr.push([i+1, recordingLeaderboards[i].username, recordingLeaderboards[i].score]);

        }

        return (
            <div class="leaderboards-content-wrapper">
                {selectedMonth && selectedYear && <div onClick={() => {setScreen("archives");}} aria-label="Back" title="Back" class="leaderboards-go-back-btn"><ArrowBackIcon/></div>}
                {topic === "all" &&
                    <div class="leaderboards-board-wrapper">
                        <div class="leaderboards-board-title">
                            Top scorers ({selectedMonth && selectedYear ? selectedMonth + " " + selectedYear : months[new Date().getMonth()]})
                            <div onClick={updateLeaderboards} aria-label="Refresh" title="Refresh" class="leaderboards-update-btn leaderboards-update-btn-hvr-rotate">
                                <LoopIcon style={{ color: "white", height: "2.5rem" }} />
                            </div>
                        </div>
                        <div class="leaderboards-board-content-wrapper-wrapper">
                            <div class="leaderboards-board-content-wrapper">
                                {leaderboardEmpty &&
                                    <div class="leaderboards-board-empty">
                                        Hmm, no one has played in a while...
                                    </div>
                                }
                                {!leaderboardEmpty &&
                                    leaderboardArr.map(([rank1, uname, pts]) => (
                                        <User rank={rank1.toString()} rating={pts} username={uname} key={rank1+200}/>
                                    ))
                                }

                            </div>
                        </div>
                    </div>
                }
                {topic === "recording" &&
                    <div class="leaderboards-board-wrapper">
                        <div class="leaderboards-board-title">
                            Top recorders ({selectedMonth && selectedYear ? selectedMonth + " " + selectedYear : months[new Date().getMonth()]})
                            <div onClick={updateLeaderboards} aria-label="Refresh" title="Refresh" class="leaderboards-update-btn leaderboards-update-btn-hvr-rotate">
                                <LoopIcon style={{ color: "white", height: "2.5rem" }} />
                            </div>
                        </div>
                        <div class="leaderboards-board-content-wrapper-wrapper">
                            <div class="leaderboards-board-content-wrapper">
                                {recordingEmpty &&
                                    <div class="leaderboards-board-empty">
                                        Hmm, no one has played in a while...
                                    </div>
                                }
                                {!recordingEmpty &&
                                    recordingLeaderboardArr.map(([rank1, uname, pts]) => (
                                        <User rank={rank1.toString()} rating={pts} username={uname} key={rank1}/>
                                    ))
                                }

                            </div>
                        </div>
                    </div>
                }
                <div class="leaderboards-topics-content-wrapper">
                    <div class="leaderboards-topics-title">
                        Your ranking
                    </div>
                    <div class="leaderboards-topics-title-divider"></div>
                    <div class="leaderboards-topic-list-wrapper">
                        <Topic name="Overall" rank={(rank > 0 ? rank.toString() : "--")} self={"all"} topic={topic} setTopic={setTopic} />
                        <Topic name="Recording" rank={(recordingRank > 0 ? recordingRank.toString() : "--")} self={"recording"} topic={topic} setTopic={setTopic} />
                    </div>
                    {(!selectedMonth || !selectedYear) && <div class="leaderboards-archive-btn" onClick={() => {setScreen("archives");}}>
                        <ArchiveIcon/> View Older Leaderboards
                    </div>}
                </div>
            </div>
        );
    } else if (screen === "archives") {
        return (
            <div class="leaderboards-content-wrapper">
                <div
                    onClick={() => {setScreen("home"); setSelectedYear(null); setSelectedMonth(null);}}
                    aria-label="Back"
                    title="Back"
                    class="leaderboards-go-back-btn"
                >
                    <ArrowBackIcon/>
                </div>
                {/* <LeaderboardMenu years={[
                    [2022, ["May", "Apr", "Mar", "Feb", "Jan"]],
                    [2021, ["Dec", "Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "Mar", "Feb", "Jan"]],
                    [2020, ["Dec", "Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "Mar", "Feb", "Jan"]],
                    [2019, ["Dec", "Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "Mar", "Feb", "Jan"]],
                    [2018, ["Dec", "Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "Mar", "Feb", "Jan"]],
                    [2017, ["Dec", "Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "Mar", "Feb", "Jan"]],
                    [2016, ["Dec", "Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "Mar", "Feb", "Jan"]]
                ]} yearCallback={setSelectedYear} monthCallback={setSelectedMonth}/> */}
                <LeaderboardMenu 
                    years={archiveSummary}
                    setBoardCallback={(year, month) => {setScreen("home"); setSelectedYear(year); setSelectedMonth(month);}}
                />
            </div>
        );
    } else if (screen === "loading") {
        return (
            <div class="leaderboards-content-wrapper">
                <div class="leaderboards-loading-wrapper">
                    Loading, please wait...
                </div>
            </div>
        )
    }

}

export default Leaderboards;