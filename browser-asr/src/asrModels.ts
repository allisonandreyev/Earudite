// Single source of truth for selectable ASR models, shared by the mic quick-override
// (AnswerBox.jsx), the Model Preferences page, and (eventually) anywhere else that needs
// to list models. Add new entries here when new models/engines become available server-side
// (see MODEL_REGISTRY in quizzr-socket-server/main.py) — everything that renders a model
// picker reads from this list instead of hardcoding ids.
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
