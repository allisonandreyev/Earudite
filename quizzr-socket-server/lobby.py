import time

QUESTION_MODES = ("text", "human", "tts")


class Lobby:
    def __init__(self, initial_player, code, gamemode, auth_token):
        self.settings = {
            "players": [initial_player],  # List of players
            "code": code,  # room code
            "teams": 0,  # Number of teams
            "max_players": 8,  # maximum total number of players in lobby
            "rounds": 1,  # number of rounds
            "questions_num": 3,  # number of questions per round
            "gap_time": 5,  # time between questions
            "post_buzz_time": 5,  # time after questions players can still buzz
            # How each question is presented: "text" = clip with the prompt on screen,
            # "human" = prompt read aloud by a person before the clip, "tts" = read aloud by a
            # computer voice. See QUESTION_MODES.
            "question_mode": "text",
        }
        self.start_time = time.time()
        self.auth_token = auth_token
        self.gamemode = gamemode
        self.game_started = False

    # returns list of players (no team indication)
    def get_players_list(self):
        if self.settings['teams'] <= 0:
            return self.settings['players']
        elif self.settings['teams'] >= 2:
            players_list = []
            for team in self.settings['players']:
                for player in team:
                    players_list.append(player)
            return players_list

    # Updates lobby settings
    def update_settings(self, settings):
        # TODO Clean input
        for setting in settings:
            if setting == 'teams':  # adjust players list depending on team number
                if self.settings['teams'] != settings['teams']:
                    if settings['teams'] == 2:
                        self.settings['players'] = [self.settings['players'], []]
                    elif settings['teams'] == 0:
                        players_list = []
                        for team in self.settings['players']:
                            for player in team:
                                players_list.append(player)
                        self.settings['players'] = players_list

            if setting == 'question_mode' and settings[setting] not in QUESTION_MODES:
                continue  # an unknown mode would reach the HLS server and every client
            if setting in self.settings:
                self.settings[setting] = settings[setting]

    # Returns current lobby state
    def state(self):
        return self.settings

    # Removes player from lobby
    def leave(self, username):
        if self.settings['teams'] <= 0:
            self.settings['players'].remove(username)
        else:
            for team in self.settings['players']:
                if username in team:
                    team.remove(username)

    # Adds player to lobby
    def join(self, username):
        # Check does not exceed max players
        if len(self.settings['players']) >= self.settings['max_players']:
            return False
        if self.settings['teams'] <= 0:
            self.settings['players'].append(username)
        else:
            self.settings['players'][0].append(username)
        return True

    def switch_team(self, username):
        if self.settings['teams'] < 2:
            return False
        if username in self.settings['players'][0]:
            self.settings['players'][0].remove(username)
            self.settings['players'][1].append(username)
            return True
        elif username in self.settings['players'][1]:
            self.settings['players'][1].remove(username)
            self.settings['players'][0].append(username)
            return True
        else:
            return False