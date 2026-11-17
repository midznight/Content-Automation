"""Tests for authentication and CLI admin management."""

import hashlib

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import hub.db.session as session_module
from hub.admin import create_agent, list_agents, revoke_agent, rotate_key
from hub.auth import (
    authenticate_agent,
    extract_raw_key_from_headers,
    generate_agent_key,
    hash_key,
)
from hub.db.base import Base
from hub.db.models import Agent


@pytest.fixture
def test_db(tmp_path, monkeypatch):
    db_file = tmp_path / "test_auth.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setenv("DATABASE_URL", db_url)

    engine = create_engine(db_url)
    Base.metadata.create_all(bind=engine)
    session_cls = sessionmaker(bind=engine)

    monkeypatch.setattr(session_module, "engine", engine)
    monkeypatch.setattr(session_module, "SessionLocal", session_cls)

    db = session_cls()
    yield db
    db.close()
    engine.dispose()


def test_hash_key():
    raw = "test_key_123"
    expected = hashlib.sha256(b"test_key_123").hexdigest()
    assert hash_key(raw) == expected


def test_extract_raw_key():
    assert extract_raw_key_from_headers({"Authorization": "Bearer key123"}) == "key123"
    assert extract_raw_key_from_headers({"authorization": "bearer key123"}) == "key123"
    assert extract_raw_key_from_headers({"X-API-Key": "key456"}) == "key456"
    assert extract_raw_key_from_headers({"x-api-key": "key456"}) == "key456"
    assert extract_raw_key_from_headers({"Other": "Value"}) is None


def test_authenticate_agent(test_db):
    raw_key = generate_agent_key()
    agent = Agent(name="muse_1", role="strategist", vendor="muse", key_hash=hash_key(raw_key))
    test_db.add(agent)
    test_db.commit()

    # Authenticate via Bearer
    auth_ag = authenticate_agent(test_db, {"Authorization": f"Bearer {raw_key}"})
    assert auth_ag is not None
    assert auth_ag.name == "muse_1"
    assert auth_ag.last_seen_at is not None

    # Authenticate via X-API-Key
    auth_ag_x = authenticate_agent(test_db, {"X-API-Key": raw_key})
    assert auth_ag_x is not None
    assert auth_ag_x.name == "muse_1"

    # Invalid key
    assert authenticate_agent(test_db, {"Authorization": "Bearer wrong_key"}) is None

    # Revoked agent
    agent.active = False
    test_db.commit()
    assert authenticate_agent(test_db, {"Authorization": f"Bearer {raw_key}"}) is None


def test_cli_admin_lifecycle(test_db, capsys):
    # 1. Create agent
    create_agent("cue_ceo", "ceo", vendor="cue")
    out = capsys.readouterr().out
    assert "berhasil dibuat" in out
    assert "agt_live_" in out

    # Verify agent exists in DB with SHA-256 hash (never raw key)
    ag = test_db.scalar(select(Agent).where(Agent.name == "cue_ceo"))
    assert ag is not None
    assert ag.role == "ceo"
    assert not ag.key_hash.startswith("agt_live_")
    assert len(ag.key_hash) == 64

    # 2. List agents - verify key is not in output
    list_agents()
    list_out = capsys.readouterr().out
    assert "cue_ceo" in list_out
    assert "ceo" in list_out
    assert "agt_live_" not in list_out
    assert ag.key_hash not in list_out

    # 3. Rotate key
    rotate_key("cue_ceo")
    rotate_out = capsys.readouterr().out
    assert "berhasil dirotasi" in rotate_out
    assert "agt_live_" in rotate_out

    # 4. Revoke agent
    revoke_agent("cue_ceo")
    revoke_out = capsys.readouterr().out
    assert "berhasil dicabut" in revoke_out

    test_db.refresh(ag)
    assert ag.active is False
