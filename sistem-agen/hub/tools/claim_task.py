"""claim_task tool: Atomically claim a queued task."""

from typing import Any

from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import select

from hub.db import session as db_session
from hub.db.models import Task
from hub.domain.state_machine import transition_task_state, utcnow
from hub.tools.common import get_authenticated_agent


def handle_claim_task(ctx: Context, task_id: str) -> dict[str, Any]:
    """Claim a queued task for execution."""
    with db_session.SessionLocal() as db:
        agent = get_authenticated_agent(ctx, db, "claim_task")

        task = db.scalar(select(Task).where(Task.id == task_id))
        if not task:
            raise ToolError(
                f"Tugas dengan ID '{task_id}' tidak ditemukan. "
                "Periksa kembali ID tugas dari daftar tugas di inbox."
            )

        if task.to_agent != agent.role and agent.role != "ceo":
            raise ToolError(
                f"Tugas '{task_id}' ditujukan untuk role '{task.to_agent}', bukan '{agent.role}'. "
                "Ambil hanya tugas yang ditugaskan kepada role Anda."
            )

        if task.status != "queued":
            raise ToolError(
                f"Tugas '{task_id}' tidak dapat diambil karena saat ini berstatus '{task.status}'. "
                "Hanya tugas berstatus 'queued' yang dapat diambil."
            )

        task.claimed_at = utcnow()
        transition_task_state(db, task, "claimed", actor=agent.name)
        db.commit()

        return {
            "task_id": task.id,
            "parent_id": task.parent_id,
            "video_id": task.video_id,
            "type": task.type,
            "title": task.title,
            "from": task.from_agent,
            "to": task.to_agent,
            "priority": task.priority,
            "status": task.status,
            "attempt": task.attempt,
            "reassigned_from": task.reassigned_from,
            "created_at": task.created_at.isoformat(),
            "claimed_at": task.claimed_at.isoformat() if task.claimed_at else None,
            "due_at": task.due_at.isoformat() if task.due_at else None,
            "payload": task.payload,
        }
