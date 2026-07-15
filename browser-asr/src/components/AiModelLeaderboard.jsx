import "../styles/Leaderboards.css";
import "../styles/AiModelLeaderboard.css";
import { useEffect, useState } from "react";
import {
    Tooltip,
} from 'react-tippy';

// MOCK DATA — placeholder until a real accuracy pipeline exists (see backend gap list: no WER/
// accuracy comparison is computed anywhere yet). Shaped like the response a future
// `/leaderboard/models` endpoint would return ({ results: [...] }) so swapping fetchMockModelLeaderboard()
// below for a real axios.get() call is the only change needed — this component's state/render
// code doesn't need to move.
const MOCK_MODEL_LEADERBOARD_DATA = [
    { modelId: "whisper-small", modelName: "Whisper Small", accuracy: 91.2, sampleSize: 1240 },
    { modelId: "whisper-base", modelName: "Whisper Base", accuracy: 87.5, sampleSize: 3050 },
    { modelId: "gcp-speech", modelName: "Google Cloud Speech-to-Text", accuracy: 85.9, sampleSize: 640 },
    { modelId: "wav2vec2-960h", modelName: "wav2vec2-large-960h (HuggingFace)", accuracy: 83.1, sampleSize: 410 },
    { modelId: "whisper-tiny", modelName: "Whisper Tiny", accuracy: 78.4, sampleSize: 2310 },
];

// MOCK — replace with e.g. axios.get(urls['dataflow'] + '/leaderboard/models').then(r => r.data.results)
// once a real accuracy pipeline exists.
function fetchMockModelLeaderboard() {
    return Promise.resolve([...MOCK_MODEL_LEADERBOARD_DATA].sort((a, b) => b.accuracy - a.accuracy));
}

// single model row — mirrors Leaderboards.jsx's User row for visual consistency
function ModelRow(props) {
    return (
        <div class="leaderboards-board-user-wrapper">
            <div class="leaderboards-board-user-rank">
                {props.rank}
            </div>
            <div class="leaderboards-board-user-name">
                {props.modelName}
            </div>
            <div class="leaderboards-board-user-rating">
                <Tooltip
                    title={props.sampleSize + " clips evaluated (mock)"}
                    position="top"
                    trigger="mouseenter"
                    unmountHTMLWhenHide="true"
                >
                    {props.accuracy.toFixed(1)}%
                </Tooltip>
            </div>
        </div>
    );
}

function AiModelLeaderboard() {
    const [models, setModels] = useState([]);

    useEffect(() => {
        fetchMockModelLeaderboard().then(setModels);
    }, []);

    return (
        <div class="leaderboards-content-wrapper">
            <div class="leaderboards-board-wrapper">
                <div class="ai-model-leaderboard-mock-banner">
                    Demo data — these numbers are placeholders, not a real accuracy metric yet.
                </div>
                <div class="leaderboards-board-title">
                    ASR models by transcription accuracy
                </div>
                <div class="leaderboards-board-content-wrapper-wrapper">
                    <div class="leaderboards-board-content-wrapper">
                        {models.map((m, i) => (
                            <ModelRow
                                key={m.modelId}
                                rank={i + 1}
                                modelName={m.modelName}
                                accuracy={m.accuracy}
                                sampleSize={m.sampleSize}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AiModelLeaderboard;
