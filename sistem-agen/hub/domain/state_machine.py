"""State machine logic and transactional audit events."""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from hub.db.models import Event, Task

VALID_TRANSITIONS: dict[str, set[str]] = {
    "queued": {"claimed"},
    "claimed": {"done", "blocked", "failed", "stale"},
    "blocked": {"superseded"},
    "failed": {"superseded"},
    "stale": {"claimed", "superseded", "failed"},
    "done": set(),
    "superseded": set(),
}


class InvalidStateTransitionError(Exception):
    """Raised when an illegal task state transition is requested."""

    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def record_event(
    db: Session,
    actor: str,
    action: str,
    task_id: str | None = None,
    video_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> Event:
    """Record an immutable event in the same transaction."""
    event = Event(
        actor=actor,
        action=action,
        task_id=task_id,
        video_id=video_id,
        detail=detail or {},
    )
    db.add(event)
    return event


def transition_task_state(
    db: Session,
    task: Task,
    new_status: str,
    actor: str,
    detail: dict[str, Any] | None = None,
) -> None:
    """Validate and transition task state, writing an event in the same transaction."""
    current_status = task.status
    allowed_next = VALID_TRANSITIONS.get(current_status, set())

    if new_status not in allowed_next:
        valid_options = (
            ", ".join(sorted(allowed_next)) if allowed_next else "tidak ada (status terminal)"
        )
        raise InvalidStateTransitionError(
            f"Transisi tugas '{task.id}' dari status '{current_status}' ke '{new_status}' "
            f"tidak sah. Status berikutnya yang diizinkan adalah: {valid_options}."
        )

    task.status = new_status
    task.updated_at = utcnow()

    event_detail = {"previous_status": current_status, "new_status": new_status}
    if detail:
        event_detail.update(detail)

    record_event(
        db=db,
        actor=actor,
        action=f"task_status_{new_status}",
        task_id=task.id,
        video_id=task.video_id,
        detail=event_detail,
    )


def check_and_mark_stale_tasks(
    db: Session,
    threshold_seconds: float = 4 * 3600,
) -> list[str]:
    """Find claimed tasks with no update for > threshold and transition to stale."""
    cutoff = utcnow() - timedelta(seconds=threshold_seconds)
    stmt = select(Task).where(Task.status == "claimed", Task.updated_at <= cutoff)
    stale_tasks = db.scalars(stmt).all()

    marked_ids: list[str] = []
    for t in stale_tasks:
        transition_task_state(
            db=db,
            task=t,
            new_status="stale",
            actor="system",
            detail={"reason": f"claimed > {threshold_seconds}s without update"},
        )
        marked_ids.append(t.id)

    if marked_ids:
        db.commit()

    return marked_ids
