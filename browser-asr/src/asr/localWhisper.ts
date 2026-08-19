// In-browser speech-to-text using transformers.js + Whisper-tiny (int8/WASM), replacing the old
// server round-trip to faster_whisper.
//
// transformers.js ships raw modern-syntax ESM (class fields) as its published entry point, which
// this app's build tooling (react-scripts 4 / webpack 4, not ejected) cannot transpile — CRA4's
// fallback babel rule for node_modules doesn't include a class-properties plugin, so a normal
// `import` of the package fails to compile. Loading it inside a dynamically-constructed module
// Worker sidesteps the bundler entirely: the worker's own source is a tiny inline script, and its
// `import` of the library runs as native browser ESM, fetched from a CDN at runtime — untouched by
// webpack/babel. As a bonus, inference then runs off the main thread instead of janking the UI.
const TRANSFORMERS_CDN_URL = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
const MODEL_ID = "Xenova/whisper-tiny.en";

const WORKER_SOURCE = `
import { pipeline, env } from "${TRANSFORMERS_CDN_URL}";
env.allowLocalModels = false;

// Multi-threaded WASM. onnxruntime-web can only use threads when the page is cross-origin
// isolated (crossOriginIsolated === true), which requires COOP/COEP response headers — set by
// server/server.js. Without them SharedArrayBuffer is unavailable and ORT silently runs on ONE
// thread, which is what made a single whisper-tiny pass cost ~1.07s no matter how short the audio
// was: the encoder cost is flat, so single-threaded is a hard latency floor.
//
// Guarded rather than assumed: if isolation is missing (headers stripped by a proxy, or an older
// browser), this falls back to 1 thread and still works, just as slowly as before.
try {
  const isolated = typeof self.crossOriginIsolated !== "undefined" && self.crossOriginIsolated;
  const cores = (self.navigator && self.navigator.hardwareConcurrency) || 4;
  // Leave headroom for the main thread's audio callback — starving it is what makes buzz
  // detection feel laggy even when inference itself is fast.
  env.backends.onnx.wasm.numThreads = isolated ? Math.max(1, Math.min(4, cores - 2)) : 1;
  self.postMessage({ diag: "threads=" + env.backends.onnx.wasm.numThreads + " isolated=" + isolated });
} catch (err) {
  self.postMessage({ diag: "thread-config failed: " + String(err && err.message || err) });
}

let pipelinePromise = null;
function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("automatic-speech-recognition", "${MODEL_ID}");
  }
  return pipelinePromise;
}

self.onmessage = async (e) => {
  const { id, type, audio } = e.data;
  if (type === "warmup") {
    getPipeline().catch((err) => console.error("[localWhisper worker] warmup failed:", err));
    return;
  }
  if (type === "transcribe") {
    try {
      const asr = await getPipeline();
      const result = await asr(audio);
      const text = Array.isArray(result) ? result[0] && result[0].text : result && result.text;
      self.postMessage({ id, text: (text || "").trim() });
    } catch (err) {
      self.postMessage({ id, error: String(err && err.message || err) });
    }
  }
};
`;

let worker: Worker | null = null;

type PendingEntry = { resolve: (text: string) => void; reject: (err: unknown) => void };
const pending = new Map<number, PendingEntry>();
let nextId = 1;

function getWorker(): Worker {
    if (worker) return worker;
    const blob = new Blob([WORKER_SOURCE], { type: "text/javascript" });
    worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
        const { id, text, error, diag } = e.data || {};
        if (diag) { console.log("[localWhisper]", diag); return; }
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        if (error) entry.reject(new Error(error));
        else entry.resolve(text || "");
    };
    worker.onerror = (err) => console.error("[localWhisper] worker error:", err);
    return worker;
}

// Kick off the model download/compile early so it's cached (browser Cache Storage) before the
// first buzz-in needs it. Safe to call multiple times.
export function warmup(): void {
    getWorker().postMessage({ type: "warmup" });
}

let transcribing = false;

// Callers should check this before calling transcribe() to avoid overlapping inference calls
// (mirrors the old server's partial_transcribing in-flight guard).
export function isTranscribing(): boolean {
    return transcribing;
}

// pcm must be a Float32Array of 16kHz mono samples. Resolves to '' if a transcription is already
// in flight instead of queueing — callers are expected to check isTranscribing() first.
export function transcribe(pcm: Float32Array): Promise<string> {
    if (transcribing) return Promise.resolve("");
    transcribing = true;
    const id = nextId++;
    const w = getWorker();
    return new Promise((resolve, reject) => {
        pending.set(id, {
            resolve: (text) => { transcribing = false; resolve(text); },
            reject: (err) => { transcribing = false; reject(err); },
        });
        w.postMessage({ id, type: "transcribe", audio: pcm });
    });
}
