const express = require("express");
const path = require("path");
const createProxyMiddleware = require("http-proxy-middleware");

const PORT = 6800;

const dataflowProxy = createProxyMiddleware({
  target: "http://localhost:5110",
  changeOrigin: true,
	secure: false,
	  "logLevel": "debug",
  ws: true,
  pathRewrite: function (path, req) {
    return path.replace("/api/dataflow", "");
  },
});

const hlsProxy = createProxyMiddleware({
  target: "http://localhost:4440",
	  "logLevel": "debug",
  changeOrigin: true,
	secure: false,
  ws: true,
  pathRewrite: function (path, req) {
    return path.replace("/api/hls", "");
  },
});

const socketProxy = createProxyMiddleware({
  target: "http://localhost:6470",
    "logLevel": "debug",
  changeOrigin: true,
	secure : false,
  ws: true,
  pathRewrite: function (path, req) {
    return path.replace("/api/socket", "");
  },
});

const app = express();

// DO NOT re-add `Cross-Origin-Opener-Policy: same-origin` here without also changing the auth
// flow. It was added to get cross-origin isolation (which unlocks SharedArrayBuffer and therefore
// multi-threaded WASM for Whisper — otherwise every transcription pass costs ~1.07s single
// threaded), and isolation did work. But it BROKE GOOGLE SIGN-IN: WhitePanel.jsx uses
// `signInFlow: 'popup'`, and the popup returns its result to the app through window.opener, which
// COOP same-origin exists precisely to sever. No sign-in, no app.
//
// The two are only reconcilable by moving Firebase to `signInFlow: 'redirect'`, which does not
// depend on window.opener. That is a real option, but it changes the login UX and COEP also risks
// blocking Firebase's cross-origin auth iframe, so it needs testing on its own rather than being
// bundled into a performance change.
//
// `same-origin-allow-popups` would keep sign-in working but does NOT grant crossOriginIsolated,
// so it buys nothing here — hence no COOP header at all. localWhisper.ts detects this at runtime
// and falls back to one thread, logging `[localWhisper] threads=N isolated=false`.

app.use(express.static("build"));

app.use("/api/dataflow/*", dataflowProxy);
app.use("/api/hls/*", hlsProxy);
app.use("/api/socket/*", socketProxy);

app.get("/*", (req, res) => {
  res.sendFile(path.join(__dirname, "./build/index.html"), (err) => {
    if (err) res.status(500).send(err);
  });
});

app.listen(PORT, "0.0.0.0", (_) => console.log("listening on ",PORT));

