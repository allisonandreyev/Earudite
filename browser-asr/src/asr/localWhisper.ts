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
    // Clear the slot on failure. A rejected promise cached here poisoned the worker for the whole
    // page: one bad model fetch (offline for a moment, a CDN blip) and every later pass awaited
    // the SAME rejected promise, so transcription could never recover without a reload.
    pipelinePromise = pipeline("automatic-speech-recognition", "${MODEL_ID}")
      .then((p) => { self.postMessage({ diag: "model ready" }); return p; })
      .catch((err) => { pipelinePromise = null; throw err; });
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

// A pass that has not answered by now is treated as lost.
//
// Sized from measurement, not from the ~1.1s the comments elsewhere assume: on an un-isolated page
// (single-threaded ORT) a warm pass is 4-5s, the first pass of a page load is ~10s, and a genuinely
// cold HTTP cache put the first pass at 26.8s. A 20s cap would therefore have recycled the worker
// on every cold start, forever. This only has to be long enough that hitting it means something is
// actually wrong — the cost of being wrong is one dropped pass, against transcription stopping
// permanently if a lost reply is never noticed at all.
const TRANSCRIBE_TIMEOUT_MS = 45000;

// Last thing that went wrong, for the UI to show. Nothing here throws on its own.
let lastError = "";
export function getLastError(): string { return lastError; }

// Settle everything outstanding and put the module back in a state where the next call can work.
//
// This is the recovery path that did not exist before. `transcribing` was cleared ONLY from a
// pending entry's resolve/reject, and those ran only when the worker sent back a message with a
// matching id — so any failure that stopped the worker replying at all (its module script failing
// to load from the CDN, the model fetch dying, a WASM crash, the worker being killed) left
// `transcribing` stuck true forever. isTranscribing() then gated out every future pass, and buzz
// and submit detection went permanently, silently dead for the life of the page. onerror only
// logged; it settled nothing.
function failAllPending(reason: string): void {
    lastError = reason;
    const entries = Array.from(pending.values());
    pending.clear();
    transcribing = false;
    entries.forEach((entry) => entry.reject(new Error(reason)));
}

function teardownWorker(reason: string): void {
    const w = worker;
    worker = null;
    failAllPending(reason);
    // Dropped rather than reused: whatever broke it is unlikely to fix itself, and getWorker()
    // builds a fresh one (re-fetching the library and model) on the next call.
    if (w) { try { w.terminate(); } catch (e) { /* already gone */ } }
}

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
        if (error) { lastError = String(error); entry.reject(new Error(error)); }
        else { lastError = ""; entry.resolve(text || ""); }
    };
    worker.onerror = (err: any) => {
        const msg = (err && (err.message || err.type)) || "worker error";
        console.error("[localWhisper] worker error:", err);
        teardownWorker("worker failed: " + msg);
    };
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
    return new Promise((resolve) => {
        // Resolves to "" rather than rejecting, on every path. Callers run this from the audio
        // callback without a .catch(), so a rejection here surfaced only as an unhandled promise
        // rejection — invisible during a game.
        const settle = (text: string) => {
            if (!pending.has(id)) return;
            pending.delete(id);
            clearTimeout(timer);
            transcribing = false;
            resolve(text);
        };
        const timer = setTimeout(() => {
            if (!pending.has(id)) return;
            console.error("[localWhisper] pass timed out after " + TRANSCRIBE_TIMEOUT_MS + "ms");
            // Recycle: a worker that missed one deadline has usually stopped answering entirely.
            teardownWorker("transcription timed out");
            resolve("");
        }, TRANSCRIBE_TIMEOUT_MS);
        pending.set(id, {
            resolve: (text) => settle(text),
            reject: (err) => {
                console.error("[localWhisper] pass failed:", err);
                settle("");
            },
        });
        try {
            w.postMessage({ id, type: "transcribe", audio: pcm });
        } catch (e) {
            teardownWorker("postMessage failed: " + String(e));
            resolve("");
        }
    });
}
