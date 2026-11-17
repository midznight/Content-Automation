"""inbox tool: Fetch queued tasks and notifications for the calling role."""

from typing import Any

from mcp.server.mcpserver import Context
from sqlalchemy import select

from hub.db import session as db_session
from hub.db.models import Event, Task
from hub.tools.common import get_authenticated_agent


def handle_inbox(ctx: Context, status: str = "queued", limit: int = 10) -> dict[str, Any]:
    """Retrieve queued/active tasks and role-specific notifications."""
    with db_session.SessionLocal() as db:
        agent = get_authenticated_agent(ctx, db, "inbox")

        # Query tasks assigned to this role
        stmt = (
            select(Task)
            .where(Task.to_agent == agent.role, Task.status == status)
            .order_by(Task.created_at.desc())
            .limit(limit)
        )
        tasks = db.scalars(stmt).all()

        task_list = [
            {
                "task_id": t.id,
                "video_id": t.video_id,
                "type": t.type,
                "title": t.title,
                "from": t.from_agent,
                "to": t.to_agent,
                "priority": t.priority,
                "status": t.status,
                "attempt": t.attempt,
                "created_at": t.created_at.isoformat(),
                "due_at": t.due_at.isoformat() if t.due_at else None,
            }
            for t in tasks
        ]

        notifications: list[dict[str, Any]] = []
        if agent.role == "ceo":
            event_stmt = (
                select(Event)
                .where(Event.action.in_(["result_ready", "needs_reassign"]))
                .order_by(Event.ts.desc())
                .limit(limit)
            )
            events = db.scalars(event_stmt).all()
            notifications = [
                {
                    "event_id": e.id,
                    "action": e.action,
                    "actor": e.actor,
                    "task_id": e.task_id,
                    "video_id": e.video_id,
                    "timestamp": e.ts.isoformat(),
                    "detail": e.detail,
                }
                for e in events
            ]

        return {
            "role": agent.role,
            "tasks": task_list,
            "notifications": notifications,
        }
