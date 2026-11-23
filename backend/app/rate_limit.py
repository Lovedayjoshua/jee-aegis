import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request, status


class SlidingWindowRateLimiter:
    """In-memory per-IP sliding-window rate limiter for auth and command endpoints."""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit exceeded. Please wait before trying again.",
                )
            q.append(now)


auth_rate_limiter = SlidingWindowRateLimiter(max_requests=20, window_seconds=60)
command_rate_limiter = SlidingWindowRateLimiter(max_requests=60, window_seconds=60)


def limit_auth_requests(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    auth_rate_limiter.check(f"auth:{ip}")


def limit_command_requests(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    command_rate_limiter.check(f"cmd:{ip}")
