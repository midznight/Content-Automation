"""Tests for database models and session configuration."""

import pytest
from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker

from hub.db.base import Base
from hub.db.models import Agent, Approval, Artifact, Event, Metric, Task, Video, utcnow
from hub.db.session import set_sqlite_pragma


@pytest.fixture
def db_session(tmp_path):
    db_file = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_file}")

    event.listen(Engine, "connect", set_sqlite_pragma)

    Base.metadata.create_all(bind=engine)
    session_cls = sessionmaker(bind=engine)
    session = session_cls()

    yield session

    session.close()
    engine.dispose()


def test_sqlite_wal_mode(db_session):
    result = db_session.execute(text("PRAGMA journal_mode;")).scalar()
    assert str(result).lower() == "wal"


def test_tables_created(db_session):
    engine = db_session.get_bind()
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    expected = {"agents", "videos", "tasks", "artifacts", "approvals", "events", "metrics"}
    assert expected.issubset(tables)


def test_insert_query_all_models(db_session):
    # Agent
    agent = Agent(name="test_agent", role="ceo", vendor="cue", key_hash="hash123")
    db_session.add(agent)

    # Video
    video = Video(topic="Fakta Unik", pillar="Sains", stage="topic")
    db_session.add(video)
    db_session.flush()

    # Task
    task = Task(
        video_id=video.id,
        type="script",
        title="Skrip Fakta Unik",
        payload={"topic": "Sains"},
        from_agent="ceo",
        to_agent="strategist",
        status="queued",
    )
    db_session.add(task)
    db_session.flush()

    # Artifact
    artifact = Artifact(
        task_id=task.id,
        video_id=video.id,
        kind="text",
        name="script.txt",
        uri="memory://script.txt",
        sha256="abc123",
        size_bytes=100,
        created_by="strategist",
    )
    db_session.add(artifact)

    # Approval
    approval = Approval(video_id=video.id, stage="topic", requested_at=utcnow())
    db_session.add(approval)

    # Event
    event_entry = Event(
        actor="ceo",
        action="send_task",
        task_id=task.id,
        video_id=video.id,
        detail={"status": "queued"},
    )
    db_session.add(event_entry)

    # Metric
    metric = Metric(video_id=video.id, window="24h", views=100, likes=10)
    db_session.add(metric)

    db_session.commit()

    # Verify queries
    assert db_session.query(Agent).count() == 1
    assert db_session.query(Video).count() == 1
    assert db_session.query(Task).count() == 1
    assert db_session.query(Artifact).count() == 1
    assert db_session.query(Approval).count() == 1
    assert db_session.query(Event).count() == 1
    assert db_session.query(Metric).count() == 1
