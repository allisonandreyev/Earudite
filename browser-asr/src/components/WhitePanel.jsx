import "../styles/WhitePanel.css";
import { useEffect, useState } from "react";
import CheckIcon from '@material-ui/icons/Check';
import Game from './Game.jsx';
import Tutorial from './Tutorial.jsx';
import Lobby from './Lobby.jsx';
import { useRecoilState, useRecoilValue, useSetRecoilState } from "recoil";
import { SCREEN, PLAY_SCREEN, SOCKET, PROFILE, AUTHTOKEN, URLS, PREVSCREEN, INTERFACE_NAME } from "../store";
import { useAlert } from 'react-alert';
import axios from 'axios';

// PAGES
import Dashboard from './Dashboard.jsx';
// import Profile from './Profile.jsx';
import Shop from './Shop.jsx';
import Play from './Play.jsx';
import Leaderboards from './Leaderboards.jsx';
import CreateAccount from './CreateAccount.jsx';

// ASSETS
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';
// Sidenav
import DashboardIcon from '@material-ui/icons/Dashboard';
// import AccountCircleIcon from '@material-ui/icons/AccountCircle';
import SportsEsportsIcon from '@material-ui/icons/SportsEsports';
import ExitToAppIcon from '@material-ui/icons/ExitToApp';
import EmojiEventsIcon from '@material-ui/icons/EmojiEvents';
import MicIcon from '@material-ui/icons/Mic';

// // Currency
// import EnergyIcon from '../assets/energy.png';
// import CoinIcon from '../assets/coin.png';

// FIREBASE
import StyledFirebaseAuth from 'react-firebaseui/StyledFirebaseAuth';
import firebase from 'firebase';
import StandardLobby from "./StandardLobby";
const firebaseConfig = {
    apiKey: "AIzaSyAG6lyTJ99-GVVp16JmmnqXKxpkZFUUtrM",
    authDomain: "reu26-9dd73.firebaseapp.com",
    projectId: "reu26-9dd73",
    storageBucket: "reu26-9dd73.firebasestorage.app",
    messagingSenderId: "764528880181",
    appId: "1:764528880181:web:d07a8779733a8dd3389f7c"
  };
// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); // if already initialized, use that one
}

const uiConfig = {
    // Popup signin flow rather than redirect flow.
    signInFlow: 'popup',
    // We will display Google and Facebook as auth providers.
    signInOptions: [
      firebase.auth.GoogleAuthProvider.PROVIDER_ID
    ],
    callbacks: {
      signInSuccessWithAuthResult: () => false,
    },
};

// original login card
function LoginCardItem(props) {
    return (
        <div class="login-card-item">
            <CheckIcon style={{ color:"green" }} fontSize="small"/>
            <div class="mr-1"></div>
            {props.text}
            
        </div>
    );
}

// body of login screen
function LoginBody() {
    const setScreen = useSetRecoilState(SCREEN);
    const setAuthtoken = useSetRecoilState(AUTHTOKEN);
    useEffect(() => {
        // console.log("FIRING");
        const unregisterAuthObserver = firebase.auth().onAuthStateChanged(user => {
            if(user) {
                firebase.auth().currentUser.getIdToken(/* forceRefresh */ true).then(function(idToken) {
                    setAuthtoken(idToken);
                    
                  }).catch(function(error) {
                    // Handle error
                  });
                setScreen(-1);
                document.location.hash = "dashboard";
            } else {
                return;
            }
        });
        return () => unregisterAuthObserver(); // Make sure we un-register Firebase observers when the component unmounts.
    }, [setAuthtoken, setScreen]);

    return (
        <div class="main-body">
            <div class="login-card">
                <div class="card-title" id="login-title">Login</div>
                <br/>
                <LoginCardItem text="Unlimited games"/>
                <LoginCardItem text="Singleplayer mode"/>
                <LoginCardItem text="Party mode"/>
                <LoginCardItem text="Play with friends"/>
                <LoginCardItem text="Contribute to ASR research"/>
                <StyledFirebaseAuth uiConfig={uiConfig} firebaseAuth={firebase.auth()} />
            </div>
            {/* TODO ADD TUTORIAL SLIDES */}
        </div>
    );
}

// title in login screen
function LoginTitle() {
    const interface_name = useRecoilValue(INTERFACE_NAME);
    return (
        <div>
            <div class="login-title">{interface_name}</div>
            <div class="login-subtitle"><b>the </b> quiz game</div>
        </div>
    );
}

// a single sidenav tab
function SidenavItem(props) {
    return (
        <div class="sidenav-tab-wrapper" onClick={props.setScreen}>
            {props.icon}
            <div class="sidenav-tab-label" style={{color: props.textColor}}>{props.label}</div>
        </div>
    );
}

function TutorialBtn() {
    const setScreen = useSetRecoilState(SCREEN);
    return (
        <div class="whitepanel-tutorial button" onClick={() => {setScreen(8);}}>
            <HelpOutlineIcon className={"whitepanel-tutorial-icon"} style={{color: "grey"}}/>
            <span class="label-hidden">Tutorial</span>
        </div>
    )
}

function TutorialBtn2(props) {
    const setScreen = useSetRecoilState(SCREEN);
    return (
        <div class="whitepanel-tutorial-2 button" onClick={() => {setScreen(8);}}>
            <HelpOutlineIcon className={"whitepanel-tutorial-icon-2"} style={{color: "grey"}}/>
            <span class="label-hidden">Tutorial</span>
        </div>
    )
}

// the sidenav
function Sidenav(props) {
    const MainColor = "#6287F7";
    const LogoutColor = "#b52121";

    const interface_name = useRecoilValue(INTERFACE_NAME);

    return (
        <div class="sidenav-wrapper">
            <div class="sidenav-logo-title">{interface_name}</div>
            <div class="sidenav-logo-subtitle"><b>the</b> quiz game</div>
            <div class="sidenav-tabs-wrapper">
                {/* <SidenavItem label="Profile" icon={<AccountCircleIcon style={{color: MainColor}}/>} setScreen={() => {props.setScreen(1); document.location.hash = "profile";}} textColor={MainColor}/> */}
                <SidenavItem label="Dashboard" icon={<DashboardIcon style={{color: MainColor}}/>} setScreen={() => {props.setScreen(2); document.location.hash = "dashboard";}} textColor={MainColor}/>
                <SidenavItem label="Play" icon={<SportsEsportsIcon style={{color: MainColor}}/>} setScreen={() => {props.setScreen(3); document.location.hash = "play";}} textColor={MainColor}/>
                <SidenavItem label="Record" icon={<MicIcon style={{color: MainColor}}/>} setScreen={() => {props.setScreen(4); document.location.hash = "record";}} textColor={MainColor}/>
                <SidenavItem label="Leaderboards" icon={<EmojiEventsIcon style={{color: MainColor}}/>} setScreen={() => {props.setScreen(5); document.location.hash = "leaderboards";}} textColor={MainColor}/>
                <SidenavItem label="Logout" icon={<ExitToAppIcon style={{color: LogoutColor}}/>} textColor={LogoutColor} setScreen={() => firebase.auth().signOut()}/>
            </div>
        </div>
    );
}



// page header w/ coins, title, and description
function PageHeader(props) {
    // const [screen, setScreen] = useRecoilState(SCREEN);
    const profile = useRecoilValue(PROFILE);
    const username = profile["username"];

    return (
        <div class="page-header-wrapper">
            <div class="page-header-left-wrapper">
                <div class="page-header-title">
                    {props.title}
                </div>
                <div class="page-header-divider"></div>
                <div class="page-header-caption">
                    {props.caption}
                </div>
            </div>
            <div class="page-header-right-wrapper">
                <div class="page-header-username">
                    {username}
                </div>
                {/* Energy */}
                {/* <div class="page-header-energy-wrapper">
                    <div class="page-header-energy-cooldowntext"></div>
                    <div class="page-header-currency-wrapper">
                        <div class="page-header-currency-text">
                            <img class="page-header-coin-icon" src={CoinIcon} alt="Energy: "/>
                            70 / 100
                        </div>
                        <div onClick={() => {setScreen(4)}} class="page-header-currency-add page-header-currency-add-hvr-grow">
                            +
                        </div>
                    </div>
                    <div class="page-header-energy-cooldowntext">+1 in 45:07</div>
                </div> */}

                {/* Coins
                <div class="page-header-currency-wrapper page-header-coin-mr">
                    <div class="page-header-currency-text">
                        <img class="page-header-coin-icon" src={CoinIcon} alt="Coins: "/>
                        1000
                    </div>
                    <div class="page-header-currency-add">+</div>
                </div> */}
            </div>
        </div>
    );
}

// wraps most pages, big white panel hook that enables page by page navigation
function BigWhitePanel() {
    const urls = useRecoilValue(URLS);
    const [screen, setScreen] = useRecoilState(SCREEN);
    const [playScreen, setPlayScreen] = useRecoilState(PLAY_SCREEN);
    const setProfile = useSetRecoilState(PROFILE);
    const alert = useAlert();
    const socket = useRecoilValue(SOCKET);
    const setAuthtoken = useSetRecoilState(AUTHTOKEN);
    const setPrevScreen = useSetRecoilState(PREVSCREEN);

    useEffect(() => {
        if(screen !== 8) {
            setPrevScreen(screen);
        }
    }, [screen, setPrevScreen]);

    // useEffect(() => {
    //     console.log("PLAYSCREEN:",playScreen);
    // }, [playScreen]);

    
    // connecting to socket server errors
    useEffect(() => {
        const alertListener = (data) => {
            if(data[0] === 'normal') {
                alert.show(data[1]);
            } else if(data[1] === 'error') {
                alert.error(data[1]);
            } else if(data[1] === 'success') {
                alert.success(data[1]);
            } else {
                alert.show(data[1]);
            }
        };
    
        socket.on("alert", alertListener);

        return function cleanSockets() {
            socket.off("alert", alertListener);
        }
    });

    // connecting to data flow server errors
    useEffect(() => {
        // Authorization callback
        function authCallback() {
            const windowhash = window.location.hash.substring(1);
            if (windowhash === "dashboard") {
                setScreen(2);
            } else if (windowhash === "profile") {
                setScreen(1);
            } else if (windowhash === "play") {
                setScreen(3);
                setPlayScreen("home");
            } else if (windowhash === "record") {
                setScreen(4);
            } else if (windowhash === "leaderboards") {
                setScreen(5);
            } else if (windowhash === "tutorial") {
                setScreen(8);
            } else {
                setScreen(2);
                // setScreen(6); // in game
                // setScreen(7);
            }
            
        }

        const unregisterAuthObserver = firebase.auth().onAuthStateChanged(user => {
          if(user) {
            firebase.auth().currentUser.getIdToken(/* forceRefresh */ true).then(function(idToken) {
                setAuthtoken(idToken);
                axios.defaults.headers.common['Authorization'] = idToken;
                axios.get(urls['dataflow'] + '/profile')
                    .then(function (response) {
                        // handle success
                        setProfile(response['data']);
                        authCallback();
                    })
                    .catch(function (error) {
                        if(!error.response) {
                            firebase.auth().signOut();
                            setScreen(0);
                            alert.error("Server connection failed");
                        } else if (error.response.status === 404) {
                            setScreen(7);
                        }
                    })
                    .then(function () {
                        // always executed
                    });
              }).catch(function(error) {
                setScreen(0);
                alert.error("Login failed");
              });
          } else {
            setScreen(0);
          }
        });
        return () => unregisterAuthObserver(); // Make sure we un-register Firebase observers when the component unmounts.
    }, [alert, setAuthtoken, setProfile, setScreen, urls, setPlayScreen]);

    useEffect(() => {
        const interval = setInterval(() => {
            const user = firebase.auth().currentUser;
            if (user) {
                user.getIdToken(true).then(idToken => setAuthtoken(idToken)).catch(() => {});
            }
        }, 50 * 60 * 1000);
        return () => clearInterval(interval);
    }, [setAuthtoken]);

    function isChrome() {
        var isChromium = window.chrome;
        var winNav = window.navigator;
        var vendorName = winNav.vendor;
        var isOpera = typeof window.opr !== "undefined";
        var isIEedge = winNav.userAgent.indexOf("Edg") > -1;
        var isIOSChrome = winNav.userAgent.match("CriOS");

        if (isIOSChrome) {
            return false;
        } else if(
            isChromium !== null &&
            typeof isChromium !== "undefined" &&
            vendorName === "Google Inc." &&
            isOpera === false &&
            isIEedge === false
        ) {
            return true;
        } else { 
            return false;
        }
    }

    function getChromeVersion () {     
        var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
    
        return raw ? parseInt(raw[2], 10) : false;
    }
    
    const [approvedDevice, setApprovedDevice] = useState(
        isChrome()
        && getChromeVersion() > 73
        && (0.7*window.innerWidth > window.innerHeight || (window.innerWidth > 950 && window.innerHeight > 700))
        );

    // console.log(isChrome());
    // console.log(getChromeVersion());
    // console.log("WIDTH: ", window.innerWidth);
    // console.log("HEIGHT: ", window.innerHeight);
    
    if(!approvedDevice) {
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <div class="content-wrapper">
                        <div class="whitepanel-approveddevice">
                            Please use Chrome 73+ and/or a device with an appropriate width-height ratio for the best experience! Other browsers may not be supported.
                            <div class="whitepanel-approveddevice-continue" onClick={()=>{setApprovedDevice(true)}}>
                                PLAY ANYWAYS
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    } else if(screen === -1){ // Loading
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <div class="content-wrapper">
                        <div class="whitepanel-loading">
                            Loading, please wait...
                        </div>
                    </div>
                </div>
            </div>
        );
    } else if(screen === -2) { // Searching for opponent 
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <div class="content-wrapper">
                        <div class="whitepanel-loading">
                            Searching for opponent, please wait...
                        </div>
                    </div>
                </div>
            </div>
        );
    } else if(screen === 0) { // login
        return (
            <div class="login-white-panel-wrapper">
                <div class="login-white-panel">
                    <LoginTitle/>
                    <LoginBody/>
                    <TutorialBtn/>
                </div>
                
            </div>
        );
    } 
    // else if(screen === 1) { // profile
    //     return (
    //         <div class="big-white-panel-wrapper">
    //             <div class="big-white-panel">
    //                 <div class="content-wrapper">
    //                     <Sidenav setScreen={setScreen}/>
    //                     <div class="page-body-wrapper">
    //                         <PageHeader title="Profile" caption="Track your statistics, match history, recordings, and rating!"/>
    //                         <div class="page-body-content-wrapper">
    //                             <Profile/>
    //                         </div>
    //                     </div>
    //                 </div>
    //             </div>
    //             <TutorialBtn2/>
    //         </div>
    //     );
    // } 
    else if(screen === 3) { // select gamemode / lobby
        if(playScreen === 'casualsolo'){
            return (
                <div class="big-white-panel-wrapper">
                    <div class="big-white-panel">
                        <div class="content-wrapper">
                            <Sidenav setScreen={setScreen}/>
                            <div class="page-body-wrapper">
                                <PageHeader title="Play" caption="Play with friends, solo, or compete on the ladder!"/>
                                <div class="page-body-content-wrapper">
                                    <StandardLobby/>
                                </div>
                            </div>
                        </div>
                    </div>
                    <TutorialBtn2/>
                </div>
            );
        } else if(playScreen === 'custom'){
            return (
                <div class="big-white-panel-wrapper">
                    <div class="big-white-panel">
                        <div class="content-wrapper">
                            <Sidenav setScreen={setScreen}/>
                            <div class="page-body-wrapper">
                                <PageHeader title="Play" caption="Play with friends, solo, or compete on the ladder!"/>
                                <div class="page-body-content-wrapper">
                                    <Lobby/>
                                </div>
                            </div>
                        </div>
                    </div>
                    <TutorialBtn2/>
                </div>
            );
        } else {
            return (
                <div class="big-white-panel-wrapper">
                    <div class="big-white-panel">
                        <div class="content-wrapper">
                            <Sidenav setScreen={setScreen}/>
                            <div class="page-body-wrapper">
                                <PageHeader title="Play" caption="Play with friends, solo, or compete on the ladder!"/>
                                <div class="page-body-content-wrapper">
                                    <Play/>
                                </div>
                            </div>
                        </div>
                    </div>
                    <TutorialBtn2/>
                </div>
            );
        } 
    } else if(screen === 4) { // Shop
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <div class="content-wrapper">
                        <Sidenav setScreen={setScreen}/>
                        <div class="page-body-wrapper">
                            <PageHeader title="Record" caption="Record questions for other users to play!"/>
                            <div class="page-body-content-wrapper">
                                <Shop/>
                            </div>
                        </div>
                    </div>
                </div>
                <TutorialBtn2/>
            </div>
        );
    } else if(screen === 5) { // leaderboards
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <div class="content-wrapper">
                        <Sidenav setScreen={setScreen}/>
                        <div class="page-body-wrapper">
                            <PageHeader title="Leaderboards" caption="Check out the top players across the globe!"/>
                            <div class="page-body-content-wrapper">
                                <Leaderboards/>
                            </div>
                        </div>
                    </div>
                </div>
                <TutorialBtn2/>
            </div>
        );
    } else if(screen === 6){ // in-game
        return (
            <Game/>
        );
    } else if(screen === 7){ // Create account
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <div class="content-wrapper">
                        <CreateAccount/>
                        <TutorialBtn/>
                    </div>
                </div>
                
            </div>
        );
    } else if(screen === 8) { // Tutorial
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <Tutorial/>
                </div>
            </div>
        );
    } else { //dashboard (screen === 2)
        return (
            <div class="big-white-panel-wrapper">
                <div class="big-white-panel">
                    <div class="content-wrapper">
                        <Sidenav setScreen={setScreen}/>
                        <div class="page-body-wrapper">
                            <PageHeader title="Dashboard" caption="Catch up on the latest news and updates!"/>
                            <div class="page-body-content-wrapper">
                                <Dashboard/>
                            </div>
                        </div>
                    </div>
                </div>
                <TutorialBtn2/>
            </div>
        );
    } 
}

export default BigWhitePanel;
