import time
from collections import deque

"""
Code written by Andrew Chen (achen4290 on GitHub)
Intended use case:
    - You have multiple endpoints that should be rate-limited at different rates and/or separately. 
    - Each user who uses your endpoints has some kind of ID that you can use to impose rate limits on a per-user basis
    - Every user has the exact same rate limit.
1. Initialize endpoints that should be rate-limited in a RateLimiter object using create_events
2. Every time a user uses your endpoint, call valid_call to determine if that user is requesting beyond their rate limit
    - If true, the user is requesting within the limit specified by create_event for that endpoint
    - If false, the user is requesting beyond the limit specified by create_event for that endpoint
"""


class RateLimiter:
    def __init__(self):
        self.calls = {}  # Event key <string> : (UserID <string> : Calls <dequeue<float>>)
        self.limits = {}  # Event key <string> : [Calls <int>, Time (sec) <int>] ie how many calls per time is allowed
        self.settings = {}  # Event key <string> : (Setting name <string> : value <?>)

    def create_event(self, event_key, max_calls=10, unit_time=60, count_invalid_calls=True):
        """
        Initializes an event in the RateLimiter object with key event_key that allows max_calls per unit_time per input
        key.
        :param string event_key: A string representing the name of the event that will be rate-limited
        :param int max_calls: The maximum number of calls to happen per unit_time
        :param float unit_time: The time span to which each user will be limited to max_calls calls by in seconds
        :param bool count_invalid_calls: If true, the rate limiter will rate limit based on both valid and invalid calls
        :return: None
        """
        if event_key in self.limits:
            raise KeyError("Event key '" + event_key +
                           "' already exists. Please use a different key.")
        self.calls[event_key] = {}
        self.limits[event_key] = [max_calls, unit_time]
        # Boolean for if the limiter also log rate-limited calls (and limit based on them for future calls)
        self.settings[event_key] = {'count_invalid_calls': count_invalid_calls}

    # Determine whether an event call is valid (create_event must be used prior to calling valid_call)
    # returns true if the call was valid and false if not
    def valid_call(self, event_key, user_id):
        """
        The rate-limited function to call right before the actual event occurs to determine if the call is valid.
        :param string event_key: A string representing the name of the event that will be checked to see if the rate has
        been exceeded
        :param string user_id: A string representing a user who is making a call to the event specified by event_key and
        needs to have their calls rate-limited
        :return bool: If true, then the call occurred at a proper time and does not need to be rate-limited. If false,
        the call should be rate-limited and the event should not occur.
        """
        # Print error if event_key doesn't exist
        if not (event_key in self.limits):
            raise KeyError("Event key '" + event_key +
                           "' does not exist. Create it first using the create_event function.")

        # If user hasn't called before
        if not (user_id in self.calls[event_key]):
            self.calls[event_key][user_id] = deque([time.time()])
            return True

        # Cleanup previous calls
        current_window = time.time() - self.limits[event_key][1]
        while len(self.calls[event_key][user_id]) > 0 and self.calls[event_key][user_id][0] < current_window:
            self.calls[event_key][user_id].popleft()
        valid = len(self.calls[event_key][user_id]) + 1 <= self.limits[event_key][0]
        if valid:
            self.calls[event_key][user_id].append(time.time())
        elif (not valid) and self.settings[event_key]['count_invalid_calls']:
            self.calls[event_key][user_id].append(time.time())
        return valid
