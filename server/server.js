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

