"""Agent authentication helpers: SHA-256 hashing and header extraction."""

import hashlib
import secrets
from collections.abc import Mapping
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from hub.db.models import Agent


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_key(raw_key: str) -> str:
    """Compute SHA-256 hex digest of a raw API key."""
    return hashlib.sha256(raw_key.strip().encode("utf-8")).hexdigest()


def generate_agent_key() -> str:
    """Generate a secure random raw API key."""
    return f"agt_live_{secrets.token_urlsafe(32)}"


def extract_raw_key_from_headers(headers: Mapping[str, str]) -> str | None:
    """Extract raw key from Authorization: Bearer <token> or X-API-Key."""
    # Normalize headers to lowercase lookup
    lower_headers = {k.lower(): v for k, v in headers.items()}

    # Check Authorization header first
    auth_header = lower_headers.get("authorization")
    if auth_header:
        parts = auth_header.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]

    # Check X-API-Key header
    api_key = lower_headers.get("x-api-key")
    if api_key:
        return api_key.strip()

    return None


def authenticate_agent(db: Session, headers: Mapping[str, str]) -> Agent | None:
    """Authenticate an active agent by headers and update last_seen_at."""
    raw_key = extract_raw_key_from_headers(headers)
    if not raw_key:
        return None

    key_digest = hash_key(raw_key)
    stmt = select(Agent).where(Agent.key_hash == key_digest, Agent.active.is_(True))
    agent = db.scalar(stmt)
    if agent:
        agent.last_seen_at = utcnow()
        db.commit()
    return agent
