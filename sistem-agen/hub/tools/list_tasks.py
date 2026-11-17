"""list_tasks tool: Query tasks with filtering by status, video, or type."""

from typing import Any

from mcp.server.mcpserver import Context
from sqlalchemy import or_, select

from hub.db import session as db_session
from hub.db.models import Task
from hub.tools.common import get_authenticated_agent


def handle_list_tasks(
    ctx: Context,
    status: str | None = None,
    video_id: str | None = None,
    type: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """List tasks with optional filters. Workers only see their own tasks."""
    with db_session.SessionLocal() as db:
        agent = get_authenticated_agent(ctx, db, "list_tasks")

        stmt = select(Task)

        # Workers only see their assigned or initiated tasks
        if agent.role != "ceo":
            stmt = stmt.where(or_(Task.to_agent == agent.role, Task.from_agent == agent.role))

        if status:
            stmt = stmt.where(Task.status == status)
        if video_id:
            stmt = stmt.where(Task.video_id == video_id)
        if type:
            stmt = stmt.where(Task.type == type)

        stmt = stmt.order_by(Task.created_at.desc()).limit(limit)
        tasks = db.scalars(stmt).all()

        return {
            "tasks": [
                {
                    "task_id": t.id,
                    "video_id": t.video_id,
                    "type": t.type,
                    "title": t.title,
                    "from": t.from_agent,
                    "to": t.to_agent,
                    "priority": t.priority,
                    "status": t.status,
                    "blocked_reason": t.blocked_reason,
                    "attempt": t.attempt,
                    "reassigned_from": t.reassigned_from,
                    "created_at": t.created_at.isoformat(),
                    "claimed_at": t.claimed_at.isoformat() if t.claimed_at else None,
                    "due_at": t.due_at.isoformat() if t.due_at else None,
                }
                for t in tasks
            ]
        }
