"""Middleware for rate limiting (60 req/min/agent) and payload size limit (256 KB)."""

import time
from collections import defaultdict, deque
from typing import ClassVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from hub.auth import extract_raw_key_from_headers, hash_key

MAX_PAYLOAD_BYTES = 256 * 1024  # 256 KB = 262,144 bytes
RATE_LIMIT_PER_MINUTE = 60


class LimitsMiddleware(BaseHTTPMiddleware):
    """Enforce 256 KB payload limit and 60 req/min per-agent rate limit."""

    # In-memory rate limiting store: identifier -> deque of timestamps
    _rate_limits: ClassVar[dict[str, deque[float]]] = defaultdict(deque)

    @classmethod
    def reset_limits(cls) -> None:
        """Reset the rate limits store (used in testing)."""
        cls._rate_limits.clear()

    async def dispatch(self, request: Request, call_next):
        # 1. Payload size check
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_PAYLOAD_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "error": (
                                f"Ukuran payload ({content_length} byte) melebihi batas maksimal "
                                f"{MAX_PAYLOAD_BYTES} byte (256 KB)."
                            )
                        },
                    )
            except ValueError:
                pass

        # 2. Rate limit check (per-agent by API key hash, or by client IP)
        raw_key = extract_raw_key_from_headers(request.headers)
        if raw_key:
            identifier = hash_key(raw_key)
        else:
            identifier = request.client.host if request.client else "unknown"

        now = time.monotonic()
        window = self._rate_limits[identifier]

        # Evict timestamps older than 60 seconds
        while window and window[0] <= now - 60.0:
            window.popleft()

        if len(window) >= RATE_LIMIT_PER_MINUTE:
            return JSONResponse(
                status_code=429,
                content={
                    "error": (
                        f"Batas {RATE_LIMIT_PER_MINUTE} req/menit per agen terlampaui. "
                        "Harap perlambat panggilan Anda."
                    )
                },
                headers={"Retry-After": "60"},
            )

        window.append(now)

        return await call_next(request)
