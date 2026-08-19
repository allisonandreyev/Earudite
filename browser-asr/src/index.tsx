import React from "react";
import ReactDOM from "react-dom";
import "./styles/index.css";
import BigWhitePanel from "./components/WhitePanel";
import VoiceNav from "./voice/VoiceNav";
import reportWebVitals from "./reportWebVitals";
import { RecoilRoot } from "recoil";
import { transitions, positions, Provider as AlertProvider } from 'react-alert';
import AlertTemplate from 'react-alert-template-basic';

const alertConfig = { // TODO custom style alert
  // you can also just use 'bottom center'
  position: positions.BOTTOM_CENTER,
  timeout: 5000,
  offset: '5px',
  // you can also just use 'scale'
  transition: transitions.SCALE
}

ReactDOM.render(
  <React.StrictMode>
    <RecoilRoot>
        <AlertProvider template={AlertTemplate} {...alertConfig}>
          <BigWhitePanel/>
          {/* Sibling of the router on purpose — VoiceNav subscribes to react-speech-recognition,
              and its re-renders must not cascade into Game/AnswerBox, whose audio callback runs on
              the main thread. See the header comment in VoiceNav.jsx. */}
          <VoiceNav/>
        </AlertProvider>
    </RecoilRoot>
  </React.StrictMode>,
  document.getElementById("root")
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
