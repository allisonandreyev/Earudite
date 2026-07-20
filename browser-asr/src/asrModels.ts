// Model ids a user can tag onto a new question-reading recording (Shop.jsx's questionModel
// preference), for a future batch evaluation pipeline that compares accuracy across sizes (see
// AiModelLeaderboard.jsx). Live answer transcription during games no longer uses this list — it
// always runs Whisper Tiny locally in-browser (see src/asr/localWhisper.ts).
export interface AsrModelOption {
    id: string;
    label: string;
}

export const ASR_MODELS: AsrModelOption[] = [
    { id: "tiny", label: "Whisper Tiny (fastest)" },
    { id: "base", label: "Whisper Base (default)" },
    { id: "small", label: "Whisper Small (most accurate)" },
];

export const DEFAULT_ASR_MODEL_ID = "base";
