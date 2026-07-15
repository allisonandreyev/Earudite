import "../styles/ModelPreferences.css";
import { useState } from "react";
import { useRecoilState } from "recoil";
import { MODEL_PREFERENCES, saveModelPreferences } from "../store";
import { ASR_MODELS } from "../asrModels";

// one "which model for X" row, reused for the question-recording and answer-transcription prefs
function ModelPreferenceRow(props) {
    return (
        <div class="model-preferences-row">
            <div class="model-preferences-row-label">
                <div class="model-preferences-row-title">{props.title}</div>
                <div class="model-preferences-row-caption">{props.caption}</div>
            </div>
            <select
                class="model-preferences-select"
                value={props.value}
                onChange={(e) => props.onChange(e.target.value)}
            >
                {ASR_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                ))}
            </select>
        </div>
    );
}

function ModelPreferences() {
    const [modelPreferences, setModelPreferences] = useRecoilState(MODEL_PREFERENCES);
    const [savedFlash, setSavedFlash] = useState(false);

    function update(field, value) {
        const next = { ...modelPreferences, [field]: value };
        setModelPreferences(next);
        saveModelPreferences(next);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
    }

    return (
        <div class="model-preferences-content-wrapper">
            <div class="model-preferences-board-wrapper">
                <div class="model-preferences-intro">
                    Choose the ASR models Earudite uses by default. The mic dropdown on the answer
                    screen can still override the answer model for a single game session — it starts
                    from whatever's saved here.
                </div>
                <ModelPreferenceRow
                    title="Recording questions"
                    caption="Tagged on new question-reading recordings for later evaluation. Not transcribed live today."
                    value={modelPreferences.questionModel}
                    onChange={(v) => update('questionModel', v)}
                />
                <ModelPreferenceRow
                    title="Transcribing answers"
                    caption="Default model used to transcribe your spoken answers during games."
                    value={modelPreferences.answerModel}
                    onChange={(v) => update('answerModel', v)}
                />
                {savedFlash && <div class="model-preferences-saved">Saved</div>}
            </div>
        </div>
    );
}

export default ModelPreferences;
