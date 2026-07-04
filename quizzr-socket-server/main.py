import eventlet
import eventlet.tpool

eventlet.monkey_patch()
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room, close_room
from collections import deque
import game
import lobby
import random
from nonsocketfunctions import lobbycode_generator, cache_user, get_user
from firebase_admin import auth, initialize_app
import os
import io
import wave
import threading
import requests
import time
import json
import string
from flask_cors import CORS
import operator
import numpy as np
from faster_whisper import WhisperModel

app = Flask(__name__)
CORS(app)
firebase_app = initialize_app()
app.config['SECRET_KEY'] = os.environ.get("FLASK_SECRET_KEY")
socketio = SocketIO(app, cors_allowed_origins="*", logger=True)

whisper_model = None  # loaded lazily on first request or at startup via --whispermodel arg

# Per-socket streaming buffers for live transcription
audio_buffers = {}       # sid -> np.ndarray (float32, 16 kHz)
partial_transcribing = set()  # sids whose transcription is currently in flight
last_transcription_time = {}  # sid -> float (epoch seconds of last partial transcription kick-off)
STREAM_SAMPLE_RATE = 16000
MIN_STREAM_SAMPLES = int(0.5 * STREAM_SAMPLE_RATE)   # start after 0.5 s of audio
STREAM_WINDOW_SAMPLES = int(1.5 * STREAM_SAMPLE_RATE)  # only transcribe the last 1.5 s (low-latency window)
STREAM_INTERVAL_S = 0.5  # minimum seconds between partial transcription kicks

# SHARED BETWEEN THREADS
current_lobby = {}  # UID : room name
usernames = {}  # UID : username
uids = {}  # username : UID
lobbies = {}  # room name : lobby object
games = {}  # room name : game object
previous_gamestate = {}  # room name : game object (used for catching when to send next question
clients = {}  # sid : username
reverse_clients = {} # username : sid
score_events = deque([])
leaderboard = []
queues = {
    "casualsolo": deque([]),
    "casualduo": deque([]),
    "rankedsolo": deque([]),
    "rankedduo": deque([]),
}

# SHARED BETWEEN THREADS

def only_connection(username): # checks if an incoming username is already actively in another lobby/game
    # return true if this is the user's only connection to lobbies/games
    try:
        # Check if user is already in something
        if not (username in reverse_clients):
            print(reverse_clients)
            # user has not connected before
            return True
        
        # Check if in something
        if (username in current_lobby):
            # user has connected to something
            lobbycode = current_lobby[username]
            
            # check lobbies
            lobby = lobbies[lobbycode]
            if not lobby.game_started:
                lobbylist = lobby.get_players_list()
                if username in lobbylist:
                    return False
                else:
                    return True

            # Check games
            current_game = games[lobbycode]
            if not current_game.active_game:
                # inactive game
                return True
            else:
                # active game
                return False
        else:
            return True
    except Exception:
        return True


def emit_game_state(sleep_time=0.1):  # emits the game state (time left on clock, who is buzzing, time remaining in
    # the buzz, points, etc.)
    while True:
        for gamecode in list(games.keys()):
            try:
                gamestate = games[gamecode].gamestate()
                if gamecode in previous_gamestate:
                    if previous_gamestate[gamecode][2] != gamestate[2]:
                        games[gamecode].get_new_question()
                else:
                    games[gamecode].get_new_question()
                socketio.emit('gamestate', gamestate, to=gamecode)
                previous_gamestate[gamecode] = gamestate
            except Exception as e:
                print(f"Error in emit_game_state for {gamecode}: {e}")
        eventlet.sleep(sleep_time)


def emit_lobby_state(
        sleep_time=0.1):  # emits the lobby state (synchronizes lobby settings between all players in the lobby)
    while True:
        for lobbycode in lobbies:
            socketio.emit('lobbystate', lobbies[lobbycode].state(), to=lobbycode)
        eventlet.sleep(sleep_time)


def leaderboard_find(player, x):
    for i in range(len(x)):
        if x[i][0] == player:
            return i
    return -1


# adds score to leaderboard
def add_score(player, score):
    current_time = time.time()
    score_events.append([current_time, player, score])
    idx = leaderboard_find(player, leaderboard)
    if idx > -1:
        leaderboard[idx][1] += score
    else:
        leaderboard.append([player, score])


def clean_leaderboards():
    current_time = time.time()
    while score_events:
        left_ele = score_events.popleft()
        if current_time - left_ele[0] < 86400:
            score_events.appendleft(left_ele)
            break
        idx = leaderboard_find(left_ele[1], leaderboard)
        leaderboard[idx][1] -= left_ele[2]
        if leaderboard[idx][1] == 0:
            del leaderboard[idx]


# TODO fix with UID support
def clean_lobbies_and_games(sleep_time=30):  # cleans dead lobbies and games (0 players, game ended, etc.)
    while True:
        current_time = time.time()
        for lobbycode in list(lobbies):
            if current_time - lobbies[lobbycode].start_time > 600 and not lobbies[lobbycode].game_started:
                socketio.emit('closelobby', {}, to=lobbycode)
                socketio.emit('alert', ['error', 'Lobby closed due to inactivity'], to=lobbycode)
                players_list = lobbies[lobbycode].get_players_list()
                for player in players_list:
                    current_lobby.pop(player, None)
                lobbies.pop(lobbycode, None)
                socketio.close_room(lobbycode)
                print('Closed lobby ' + str(lobbycode) + ' due to inactivity')
        for gamecode in list(games):
            game = games[gamecode]
            if not game.active_game:
                final_pts = game.points
                if game.teams == 0:
                    for player in final_pts:
                        add_score(player, final_pts[player])
                elif game.teams == 2:
                    for team in final_pts:
                        for player in team:
                            add_score(player, team[player])

                lobbies.pop(gamecode, None)
                games.pop(gamecode, None)
                print('Closed game ' + str(gamecode))
        eventlet.sleep(sleep_time)


@app.route('/')
def sessions():
    return render_template('session.html')


# Socket endpoint for sending all users in a lobby to the lobby loading screen while the streams are created
@socketio.on('lobbyloading')  # makes user in lobby go to loading screen
def lobby_loading(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    lobby = current_lobby[user['username']]
    username = user['username']
    emit('lobbyloading', {}, to=lobby)


# Socket endpoint for starting a lobby
@socketio.on('startlobby')  # starts a lobby and makes user join
def start_lobby(json, methods=['GET', 'POST']):
    cache_user(json['auth'])
    user = get_user(json['auth'])
    username = user['username']

    # Clean up any stale session state so a user can always start a fresh lobby
    old_lobby = current_lobby.pop(username, None)
    if old_lobby and old_lobby in lobbies:
        try:
            lobbies[old_lobby].leave(username)
        except Exception:
            pass

    clients[request.sid] = username
    reverse_clients[username] = request.sid

    lobbycode = lobbycode_generator(6)
    while lobbycode in lobbies:
        lobbycode = lobbycode_generator(6)
    lobbies[lobbycode] = lobby.Lobby(username, lobbycode, json['gamemode'], json['auth'])
    join_room(lobbycode)
    current_lobby[username] = lobbycode
    print("Lobby started. Code: " + lobbycode)
    emit('lobbystate', lobbies[lobbycode].state(), to=lobbycode)
    emit('alert', ['success', 'Started lobby ' + lobbycode])


# Socket endpoint for joining a lobby
@socketio.on('joinlobby')  # if lobby with given code exists, join it. otherwise, alert failed
def join_lobby(json, methods=['GET', 'POST']):
    cache_user(json['auth'])
    user = get_user(json['auth'])
    username = user['username']
    lobbycode = json['lobby']
    
    if not only_connection(username):
        emit('alert', ['error', 'Already in a running lobby/game'])
        return

    clients[request.sid] = username
    reverse_clients[username] = request.sid

    if not (lobbycode in lobbies):
        emit('alert', ['error', 'Lobby ' + str(lobbycode) + ' does not exist'])
        return
    if lobbies[lobbycode].join(username):
        current_lobby[username] = lobbycode
        join_room(lobbycode)
        emit('lobbystate', lobbies[lobbycode].state(), to=lobbycode)
        emit('alert', ['success', 'Joined lobby ' + str(lobbycode)])
        emit('alert', ['success', str(username) + ' joined the lobby'], include_self=False, to=lobbycode)
    else:
        emit('alert', ['error', 'Lobby ' + str(lobbycode) + ' is full'])


# Socket endpoint for switching teams
@socketio.on('switchteam')
def switch_team(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    lobby = current_lobby[user['username']]

    result = lobbies[lobby].switch_team(json['user'])
    if result:
        emit('lobbystate', lobbies[lobby].state(), to=lobby)
        emit('alert', ['success', str(json['user']) + ' switched teams'], to=lobby)
    else:
        emit('alert', ['error', 'Switching teams failed'], to=lobby)


# Socket endpoint for updating settings in-game
@socketio.on('updatesettings')
def update_settings(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    lobby = current_lobby[user['username']]

    lobbies[lobby].update_settings(json['settings'])
    emit('lobbystate', lobbies[lobby].state(), to=lobby)


# Socket endpoint for leaving a lobby
@socketio.on('leavelobby')
def leave_lobby(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    username = user['username']

    lobby = current_lobby.pop(username, None)
    if lobby is None:
        return

    leave_room(lobby)

    if lobby not in lobbies:
        return

    lobbies[lobby].leave(username)
    emit('lobbystate', lobbies[lobby].state(), to=lobby)
    emit('alert', ['show', str(username) + ' left the lobby'], to=lobby)


# Socket endpoint for starting a game from a lobby
@socketio.on('startgame')
def start_game(json, methods=['GET', 'POST']):
    # Start game with correct lobby parameters according to key
    user = get_user(json['auth'])
    lobby = current_lobby[user['username']]

    single_game = game.Game(lobbies[lobby], socketio)
    if single_game.good_game:
        games[lobby] = single_game
        print("Game started in lobby " + lobby)
        lobbies[lobby].game_started = True
        emit('gamestarted', {}, to=lobby)


# Socket endpoint for buzzing in game
@socketio.on('buzz')
def buzz(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    lobby = current_lobby[user['username']]
    username = user['username']

    buzzed = games[lobby].buzz(username)
    if buzzed == 2:
        emit('buzzed', username, to=lobby)
    elif buzzed == 1:
        emit('alert', ['error', "You can't buzz twice"])
    elif buzzed == 0:
        emit('alert', ['error', "You can't buzz right now"])


# Socket endpoint for answering by text
@socketio.on('answer')
def answer(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    username = user['username']
    lobby = current_lobby[user['username']]

    # Snapshot the streamed answer audio before game.answer() yields to eventlet
    sid = request.sid
    buf = audio_buffers.get(sid)
    answer_audio = buf.copy() if buf is not None and len(buf) > 0 else None
    auth_token = json['auth']

    answered = games[lobby].answer(username, json['answer'])
    if not answered:
        emit('alert', ['error', "You can't answer right now"])
        return

    # Upload the answer recording to the shared DB (GridFS) via the backend
    meta = games[lobby].last_answer_meta
    if answer_audio is not None and meta is not None and len(answer_audio) >= MIN_STREAM_SAMPLES:
        wav_bytes = _pcm_to_wav_bytes(answer_audio)
        eventlet.spawn(_upload_answer_audio, wav_bytes, auth_token, meta)


# Socket endpoint for giving vote feedback
@socketio.on('feedback')
def answer(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    username = user['username']
    lobby = current_lobby[user['username']]
    vote = json['vote']
    print(username + " rated a recording " + vote)
    if lobby in games.keys():
        game = games[lobby]
        qid = game.questions[game.question - 1][0]
        if vote == "good":
            requests.patch(os.environ.get("BACKEND_URL") + '/upvote/' + qid, headers={"Authorization": json['auth']})
        if vote == "bad":
            requests.patch(os.environ.get("BACKEND_URL") + '/downvote/' + qid, headers={"Authorization": json['auth']})


# Socket endpoint for Whisper audio answer results
@socketio.on('audioanswer')
def audioanswer(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    username = user['username']
    lobby = current_lobby[user['username']]

    transcription = json.get('transcription', '')
    answered = games[lobby].classifier_answer(username, transcription)
    if not answered:
        emit('alert', ['error', "You can't answer right now"])


# Socket endpoint for getting the leaderboard
@socketio.on('leaderboards')
def leaderboards(json, methods=['GET', 'POST']):
    user = get_user(json['auth'])
    username = user['username']

    clean_leaderboards()
    leaderboard1 = sorted(leaderboard, key=operator.itemgetter(1), reverse=True)
    try:
        idx = leaderboard_find(username, leaderboard1)
        if idx == -1:
            emit('leaderboards', {'leaderboard': leaderboard1[0:10], 'rank': [-1, len(leaderboard)]})
            return
        rank = leaderboard_find(username, leaderboard1) + 1
        emit('leaderboards', {'leaderboard': leaderboard1[0:10], 'rank': [rank, len(leaderboard)]})
    except:
        emit('leaderboards', {'leaderboard': leaderboard1[0:10], 'rank': [-1, -1]})


@socketio.on('disconnect')
def user_disconnected():
    username = clients.get(request.sid)
    if username is None:
        return

    lobby = current_lobby.pop(username, None)
    if lobby is None:
        return

    leave_room(lobby)

    if lobby not in lobbies:
        return

    lobbies[lobby].leave(username)
    emit('lobbystate', lobbies[lobby].state(), to=lobby)
    emit('alert', ['show', str(username) + ' left the lobby'], to=lobby)

def _run_whisper(audio_path):
    segments, _ = whisper_model.transcribe(audio_path, language="en")
    return " ".join(seg.text for seg in segments).strip()


def _run_whisper_array(audio_array):
    segments, _ = whisper_model.transcribe(
        audio_array,
        language="en",
        vad_filter=True,               # skip silence — much faster
        condition_on_previous_text=False,  # avoid hallucinating from prior context
    )
    return " ".join(seg.text for seg in segments).strip()


def _pcm_to_wav_bytes(pcm, rate=STREAM_SAMPLE_RATE):
    """Encode a float32 [-1, 1] PCM numpy array into 16-bit mono WAV bytes."""
    clipped = np.clip(pcm, -1.0, 1.0)
    int16 = (clipped * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(int16.tobytes())
    return buf.getvalue()


def _upload_answer_audio(wav_bytes, auth_token, meta):
    """POST a game answer recording to the backend for storage in the shared DB (GridFS)."""
    try:
        files = {"audio": ("answer.wav", wav_bytes, "audio/wav")}
        data = {
            "qb_id": str(meta.get("qid", "")),
            "transcript": meta.get("answer", ""),
            "correct": "true" if meta.get("correct") else "false",
        }
        resp = requests.post(
            os.environ.get("BACKEND_URL") + "/game_answer_audio",
            files=files,
            data=data,
            headers={"Authorization": auth_token},
            timeout=30,
        )
        print(f"Answer audio upload -> {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print("Answer audio upload failed:", e)


# Socket.IO live streaming handlers
@socketio.on('start_audio_stream')
def start_audio_stream(data):
    audio_buffers[request.sid] = np.array([], dtype=np.float32)


@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    sid = request.sid
    if sid not in audio_buffers:
        return
    chunk = np.frombuffer(data, dtype=np.float32)
    audio_buffers[sid] = np.concatenate([audio_buffers[sid], chunk])

    now = time.time()
    since_last = now - last_transcription_time.get(sid, 0)
    if len(audio_buffers[sid]) < MIN_STREAM_SAMPLES or sid in partial_transcribing or since_last < STREAM_INTERVAL_S:
        return

    partial_transcribing.add(sid)
    last_transcription_time[sid] = now
    # Transcribe the full buffer so the answer box grows incrementally instead of
    # showing rolling 1.5-s fragments. Cap at 10 s to bound Whisper latency.
    full = audio_buffers[sid]
    MAX_PARTIAL_SAMPLES = int(10 * STREAM_SAMPLE_RATE)
    buf = full[-MAX_PARTIAL_SAMPLES:].copy() if len(full) > MAX_PARTIAL_SAMPLES else full.copy()

    def do_transcription(buf, target_sid):
        try:
            if whisper_model is None:
                return
            text = eventlet.tpool.execute(_run_whisper_array, buf)
            if text:
                socketio.emit('partial_transcription', {'text': text}, to=target_sid)
        except Exception as e:
            print("Streaming transcription error:", e)
        finally:
            partial_transcribing.discard(target_sid)

    eventlet.spawn(do_transcription, buf, sid)


@socketio.on('reset_audio_stream')
def reset_audio_stream(data):
    """Clear the buffer without triggering final transcription (used on buzz-in and question change)."""
    sid = request.sid
    audio_buffers[sid] = np.array([], dtype=np.float32)
    last_transcription_time.pop(sid, None)
    partial_transcribing.discard(sid)


@socketio.on('stop_audio_stream')
def stop_audio_stream(data):
    sid = request.sid
    buf = audio_buffers.pop(sid, None)
    partial_transcribing.discard(sid)
    last_transcription_time.pop(sid, None)

    # Final transcription of full buffer — sent back so client can auto-submit
    if buf is None or len(buf) < MIN_STREAM_SAMPLES or whisper_model is None:
        return

    def do_final(buf, target_sid):
        try:
            text = eventlet.tpool.execute(_run_whisper_array, buf)
            if text:
                socketio.emit('final_transcription', {'text': text}, to=target_sid)
        except Exception as e:
            print("Final transcription error:", e)

    eventlet.spawn(do_final, buf, sid)


@app.route('/audioanswerupload', methods=['POST'])
def audioanswerupload():
    user = get_user(request.form.get("auth"))
    username = user['username']
    lobby = current_lobby[user['username']]

    # get qid using the question/round captured by the client at buzz time
    current_game = games[lobby]
    client_round = int(request.form.get("round", current_game.round))
    client_question = int(request.form.get("question", current_game.question))
    qid = current_game.answering_ids[client_round - 1][client_question - 1]

    # upload file and get filename
    file = request.files['audio']
    filename = ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(20)) + '.wav'
    while os.path.exists('./answer-audios/' + filename):
        filename = ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(20)) + '.wav'

    audio_path = os.path.join('./answer-audios', filename)
    file.save(audio_path)
    file.close()

    # transcribe with Whisper (run in thread pool so eventlet green threads aren't blocked)
    transcription = ""
    if whisper_model is not None:
        try:
            transcription = eventlet.tpool.execute(_run_whisper, audio_path)
        except Exception as e:
            print("Whisper transcription error:", e)

    print(f"Whisper transcribed '{filename}' as: {transcription!r}")
    response = jsonify({'filename': filename, 'transcription': transcription})
    return response


# Runs the flask socketio server
def run_socketio():
    pass


# Runs the flask server
def run_flask():
    app.run(port=int(os.environ.get("SOCKET_FLASK_PORT")), host="0.0.0.0")


# # Runs the asyncio tasks permanently (game state, lobby state, cleaning dead lobbies and games)
# def run_asyncio():
#     loop = asyncio.new_event_loop()
#     asyncio.set_event_loop(loop)
#     loop.create_task(
#         emit_game_state())  # emits the game state (time left on clock, who is buzzing, time remaining in the buzz, points, etc.)
#     loop.create_task(
#         emit_lobby_state())  # emits the lobby state (synchronizes lobby settings between all players in the lobby)
#     loop.create_task(clean_lobbies_and_games())  # cleans dead lobbies and games (0 players, game ended, etc.)
#     loop.run_forever()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Run the socket server", add_help=True)
    parser.add_argument(
        "--socketport",
        dest="socketport",
        type=int,
        default=6571,
    )
    parser.add_argument(
        "--secretpath",
        dest="secretpath",
        type=str,
        default="/fs/clip-quiz/saptab1/ASRQA/Interface/quizzr-socket-server/quizzr.json",
    )
    parser.add_argument(
        "--handshake",
        dest="handshake",
        type=str,
        default="I-AM-A-SECRET-KEY",
    )
    parser.add_argument(
        "--hlsurl",
        dest="hlsurl",
        type=str,
        default="http://localhost:4541",
    )
    parser.add_argument(
        "--backendurl",
        dest="backendurl",
        type=str,
        default="http://localhost:5110",
    )
    parser.add_argument(
        "--whispermodel",
        dest="whispermodel",
        type=str,
        default="base",
        help="Whisper model size: tiny, base, small, medium, large",
    )
    args = parser.parse_args()
    os.environ["HLS_HANDSHAKE"] = args.handshake
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = args.secretpath
    os.environ["HLS_URL"] = args.hlsurl
    os.environ["BACKEND_URL"] = args.backendurl
    os.environ["SOCKET_PORT"] = str(args.socketport)

    print(f"Loading Whisper model '{args.whispermodel}'...")
    whisper_model = WhisperModel(args.whispermodel, device="cpu", compute_type="int8")
    print("Whisper model loaded.")
    eventlet.spawn(emit_game_state)
    eventlet.spawn(emit_lobby_state)
    eventlet.spawn(clean_lobbies_and_games)
    socketio.run(app, port=int(os.environ.get("SOCKET_PORT")), host='0.0.0.0', log_output=True)
