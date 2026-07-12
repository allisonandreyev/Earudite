# Earudite

Earudite is a platform designed to crowdsource the collection of ASR (Automatic Speech Recognition) training data using Quiz Bowl-style gameplay. Users record themselves reading questions aloud and answer questions by voice, generating labeled audio data.

## Components

| Component | Tech | Port | Description |
|---|---|---|---|
| `browser-asr` | React/TypeScript | 3000 | Frontend UI |
| `quizzr-server` | Python/Flask (gunicorn) | 5110 | Data flow server: question selection, audio pre-screening, user auth, leaderboards |
| `quizzr-socket-server` | Python/Flask-SocketIO | 4000 | Real-time game server: lobbies, matchmaking, game state, audio classification |
| `server` | Node.js/Express | 8700 | Proxy + frontend host |
| `hls` | Python/Flask | 4440 | HLS audio streaming server |

## Prerequisites

- **Python environment:** `/opt/anaconda3/envs/earudite/` (Python 3.11)
- **MongoDB Atlas** connection string (ask a team member)
- **Firebase credentials:** `quizzr-server/instance/secrets/firebase_storage_key.json` (Firebase project: `earudite-5aa9e`)
- **Node.js** for the `server` component

## Running

All three backend services must use `nohup` with log redirection — the process suspends otherwise.

Replace `<CONNECTION_STRING>` with the MongoDB Atlas connection string and `<FIREBASE_KEY_PATH>` with the absolute path to `quizzr-server/instance/secrets/firebase_storage_key.json`.

### 1. Data Flow Server (quizzr-server)

```bash
cd quizzr-server
CONNECTION_STRING="<CONNECTION_STRING>" nohup /opt/anaconda3/envs/earudite/bin/gunicorn \
  -w 4 -b 0.0.0.0:5110 "server:create_app()" >> /tmp/quizzr_server.log 2>&1 &
```

### 2. HLS Streaming Server

```bash
cd hls
CONNECTION_STRING="<CONNECTION_STRING>" nohup /opt/anaconda3/envs/earudite/bin/python3.11 \
  hls_server.py >> /tmp/hls_server.log 2>&1 &
```

### 3. Socket Server (quizzr-socket-server)

```bash
cd quizzr-socket-server
nohup /opt/anaconda3/envs/earudite/bin/python3.11 main.py \
  --socketport 4000 \
  --secretpath "<FIREBASE_KEY_PATH>" \
  --hlsurl "http://localhost:4440" \
  --backendurl "http://localhost:5110" \
  --whispermodel base >> /tmp/socket_server.log 2>&1 &
```

### 4. Proxy + Frontend Host (server)

```bash
cd server
node server.js
```

### 5. Frontend (browser-asr)

```bash
cd browser-asr
npm start
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Notes

- **Audio source:** Audio clips come from the [Pinafore/audio\_data](https://github.com/Pinafore/audio_data) GitHub repo via `combined (1).json`. Audio is matched to questions by **question text** (exact/prefix match), not by `qb_id`.
- **Stuck workers:** If quizzr-server becomes unresponsive, kill all workers with `lsof -ti :5110 | xargs kill -9` and restart.
- **Log files:** `/tmp/quizzr_server.log`, `/tmp/hls_server.log`, `/tmp/socket_server.log`

## Project Team Members

Saptarashmi Bandyopadhyay, Shivam Malhotra, Andrew Chen, Christopher Rapp