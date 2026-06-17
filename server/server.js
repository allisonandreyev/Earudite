const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const multer = require("multer");
const createProxyMiddleware = require("http-proxy-middleware");

const PORT = 6800;

// --- Whisper.cpp transcription setup ---
const { execFile } = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
ffmpeg.setFfmpegPath(ffmpegPath);

const upload = multer({ dest: os.tmpdir() });

const WHISPER_CLI = path.join(
  __dirname,
  "node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli"
);
const WHISPER_MODEL = path.join(
  __dirname,
  "node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-base.en-q5_1.bin"
);

function toWav16k(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

function transcribeFile(wavPath) {
  return new Promise((resolve, reject) => {
    execFile(
      WHISPER_CLI,
      ["-m", WHISPER_MODEL, "-f", wavPath, "-nt", "-l", "en", "--no-prints"],
      { timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      }
    );
  });
}

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

// POST /api/transcribe — multipart field "audio", returns { text }
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no audio file provided" });
  console.log(`[transcribe] received ${req.file.originalname} (${req.file.size} bytes)`);
  const wavPath = req.file.path + ".wav";
  try {
    console.log("[transcribe] converting to 16kHz mono WAV...");
    await toWav16k(req.file.path, wavPath);
    console.log("[transcribe] running whisper...");
    const text = await transcribeFile(wavPath);
    console.log(`[transcribe] result: "${text}"`);
    res.json({ text });
  } catch (err) {
    console.error("[transcribe] error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
    fs.unlink(wavPath, () => {});
  }
});

app.get("/*", (req, res) => {
  res.sendFile(path.join(__dirname, "./build/index.html"), (err) => {
    if (err) res.status(500).send(err);
  });
});

app.listen(PORT, "0.0.0.0", (_) => console.log("listening on ",PORT));

