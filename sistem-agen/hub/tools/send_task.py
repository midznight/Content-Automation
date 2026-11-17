"""send_task tool: Dispatch tasks from CEO to worker agents."""

from datetime import datetime
from typing import Any

from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import select

from hub.db import session as db_session
from hub.db.models import Task
from hub.domain.permissions import PermissionDeniedError, validate_send_task_route
from hub.domain.state_machine import record_event, transition_task_state
from hub.tools.common import get_authenticated_agent


def handle_send_task(
    ctx: Context,
    to: str,
    type: str,
    title: str,
    payload: dict[str, Any],
    video_id: str | None = None,
    priority: str = "normal",
    due_at: str | None = None,
    reassigned_from: str | None = None,
) -> dict[str, Any]:
    """Dispatch a new task to an agent according to the permission matrix."""
    with db_session.SessionLocal() as db:
        agent = get_authenticated_agent(ctx, db, "send_task")

        # Validate task routing permissions
        try:
            validate_send_task_route(from_role=agent.role, to_role=to, task_type=type)
        except PermissionDeniedError as exc:
            raise ToolError(str(exc)) from exc

        parsed_due_at = None
        if due_at:
            try:
                parsed_due_at = datetime.fromisoformat(due_at)
            except ValueError:
                raise ToolError(
                    f"Format parameter due_at '{due_at}' tidak valid. "
                    "Gunakan format ISO 8601 (misal: 2026-11-20T09:00:00Z)."
                )

        # Handle reassignment failover
        if reassigned_from:
            old_task = db.scalar(select(Task).where(Task.id == reassigned_from))
            if old_task and old_task.status in {"blocked", "failed", "stale"}:
                transition_task_state(
                    db=db,
                    task=old_task,
                    new_status="superseded",
                    actor=agent.name,
                    detail={"reassigned_to_role": to},
                )

        new_task = Task(
            video_id=video_id,
            type=type,
            title=title,
            payload=payload,
            priority=priority,
            from_agent=agent.role,
            to_agent=to,
            status="queued",
            reassigned_from=reassigned_from,
            due_at=parsed_due_at,
        )
        db.add(new_task)
        db.flush()

        record_event(
            db=db,
            actor=agent.name,
            action="send_task",
            task_id=new_task.id,
            video_id=video_id,
            detail={"to": to, "type": type, "title": title, "priority": priority},
        )

        db.commit()

        return {
            "task_id": new_task.id,
            "status": "queued",
            "to": to,
            "type": type,
            "message": f"Tugas '{title}' bertipe '{type}' berhasil dikirim ke role '{to}'.",
        }
