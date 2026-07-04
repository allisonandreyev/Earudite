import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self):
        self._events = {}
        self._calls = defaultdict(lambda: defaultdict(deque))

    def create_event(self, event, max_calls, unit_time):
        self._events[event] = {"max_calls": max_calls, "unit_time": unit_time}

    def valid_call(self, event, user_id):
        if event not in self._events:
            return True
        cfg = self._events[event]
        max_calls = cfg["max_calls"]
        unit_time = cfg["unit_time"]
        now = time.time()
        q = self._calls[event][user_id]
        while q and now - q[0] > unit_time:
            q.popleft()
        if len(q) >= max_calls:
            return False
        q.append(now)
        return True
