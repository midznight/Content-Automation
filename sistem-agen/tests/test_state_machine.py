"""Tests for task state machine, transactional audit logging, and stale detection."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from hub.db.base import Base
from hub.db.models import Event, Task
from hub.domain.state_machine import (
    InvalidStateTransitionError,
    check_and_mark_stale_tasks,
    record_event,
    transition_task_state,
)


@pytest.fixture
def db_session(tmp_path):
    db_file = tmp_path / "test_sm.db"
    engine = create_engine(f"sqlite:///{db_file}")
    Base.metadata.create_all(bind=engine)
    session_cls = sessionmaker(bind=engine)
    db = session_cls()
    yield db
    db.close()
    engine.dispose()


def test_legal_task_transitions(db_session):
    task = Task(
        type="script",
        title="Skrip Uji",
        from_agent="ceo",
        to_agent="strategist",
        status="queued",
    )
    db_session.add(task)
    db_session.commit()

    # queued -> claimed
    transition_task_state(db_session, task, "claimed", actor="strategist")
    db_session.commit()
    assert task.status == "claimed"

    # claimed -> done
    transition_task_state(db_session, task, "done", actor="strategist")
    db_session.commit()
    assert task.status == "done"

    # Events recorded in DB
    events = db_session.scalars(
        select(Event).where(Event.task_id == task.id).order_by(Event.id)
    ).all()
    actions = [e.action for e in events]
    assert "task_status_claimed" in actions
    assert "task_status_done" in actions


def test_illegal_task_transitions(db_session):
    task = Task(
        type="script",
        title="Skrip Uji Ilegal",
        from_agent="ceo",
        to_agent="strategist",
        status="queued",
    )
    db_session.add(task)
    db_session.commit()

    # queued -> done is illegal
    with pytest.raises(InvalidStateTransitionError) as exc_info:
        transition_task_state(db_session, task, "done", actor="strategist")
    err = str(exc_info.value)
    assert "tidak sah" in err
    assert "claimed" in err

    # move to claimed
    transition_task_state(db_session, task, "claimed", actor="strategist")
    # claimed -> queued is illegal
    with pytest.raises(InvalidStateTransitionError):
        transition_task_state(db_session, task, "queued", actor="strategist")


def test_audit_event_in_same_transaction(db_session):
    task = Task(
        type="fact_check",
        title="Uji Audit Transaksi",
        from_agent="ceo",
        to_agent="fact_checker",
        status="queued",
    )
    db_session.add(task)
    db_session.flush()

    record_event(
        db=db_session,
        actor="ceo",
        action="send_task",
        task_id=task.id,
        detail={"payload": {}},
    )
    db_session.commit()

    ev = db_session.scalar(select(Event).where(Event.task_id == task.id))
    assert ev is not None
    assert ev.action == "send_task"
    assert ev.actor == "ceo"


def test_stale_task_simulation(db_session):
    task = Task(
        type="render",
        title="Render Lama",
        from_agent="ceo",
        to_agent="animator",
        status="claimed",
    )
    db_session.add(task)
    db_session.commit()

    # Artificially set updated_at to 5 hours ago
    five_hours_ago = datetime.now(timezone.utc) - timedelta(hours=5)
    task.updated_at = five_hours_ago
    db_session.commit()

    stale_ids = check_and_mark_stale_tasks(db_session, threshold_seconds=4 * 3600)
    assert task.id in stale_ids

    db_session.refresh(task)
    assert task.status == "stale"

    # Event recorded
    event = db_session.scalar(
        select(Event).where(Event.task_id == task.id, Event.action == "task_status_stale")
    )
    assert event is not None
    assert event.actor == "system"


def test_failover_superseded_transition(db_session):
    task = Task(
        type="render",
        title="Render Gagal",
        from_agent="ceo",
        to_agent="animator",
        status="claimed",
    )
    db_session.add(task)
    db_session.commit()

    # Move to blocked
    transition_task_state(
        db_session,
        task,
        "blocked",
        actor="animator",
        detail={"blocked_reason": "limit"},
    )
    db_session.commit()
    assert task.status == "blocked"

    # Reassigning transitions blocked -> superseded
    transition_task_state(
        db_session,
        task,
        "superseded",
        actor="ceo",
        detail={"reassigned_to": "animator_backup"},
    )
    db_session.commit()
    assert task.status == "superseded"
