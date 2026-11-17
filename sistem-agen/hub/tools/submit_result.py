"""submit_result tool: Submit execution result, blocked status, or failure."""

from typing import Any

from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import select

from hub.db import session as db_session
from hub.db.models import Task
from hub.domain.state_machine import record_event, transition_task_state
from hub.tools.common import get_authenticated_agent


def handle_submit_result(
    ctx: Context,
    task_id: str,
    status: str,
    result: dict[str, Any] | None = None,
    blocked_reason: str | None = None,
) -> dict[str, Any]:
    """Submit completed result, blocked status, or task failure."""
    valid_statuses = {"done", "blocked", "failed"}
    if status not in valid_statuses:
        status_list = ", ".join(sorted(valid_statuses))
        raise ToolError(f"Status '{status}' tidak valid. Pilihan status sah: {status_list}.")

    if status == "blocked" and not blocked_reason:
        raise ToolError(
            "Parameter 'blocked_reason' wajib diisi saat status 'blocked' "
            "(misal: 'limit', 'failed', atau 'needs_human')."
        )

    with db_session.SessionLocal() as db:
        agent = get_authenticated_agent(ctx, db, "submit_result")

        task = db.scalar(select(Task).where(Task.id == task_id))
        if not task:
            raise ToolError(f"Tugas dengan ID '{task_id}' tidak ditemukan.")

        if task.to_agent != agent.role and agent.role != "ceo":
            raise ToolError(
                f"Anda ({agent.role}) bukan pemilik atau penerima tugas '{task_id}'. "
                "Hanya pemegang tugas yang dapat mengirimkan hasil."
            )

        if task.status != "claimed":
            raise ToolError(
                f"Tugas '{task_id}' berstatus '{task.status}', bukan 'claimed'. "
                "Tugas harus diklaim terlebih dahulu sebelum mengirimkan hasil."
            )

        task.result = result or {}
        task.blocked_reason = blocked_reason

        # Transition task state and write task_status event
        transition_task_state(
            db=db,
            task=task,
            new_status=status,
            actor=agent.name,
            detail={"blocked_reason": blocked_reason},
        )

        # Notify CEO: if render failed or blocked with limit/failed -> needs_reassign
        is_failover = task.type == "render" and (
            status == "failed" or (status == "blocked" and blocked_reason in {"limit", "failed"})
        )

        notification_action = "needs_reassign" if is_failover else "result_ready"
        record_event(
            db=db,
            actor=agent.name,
            action=notification_action,
            task_id=task.id,
            video_id=task.video_id,
            detail={
                "task_id": task.id,
                "task_type": task.type,
                "status": status,
                "blocked_reason": blocked_reason,
            },
        )

        db.commit()

        return {
            "task_id": task.id,
            "status": task.status,
            "notification": notification_action,
            "message": f"Hasil untuk tugas '{task.id}' berhasil disimpan dengan status '{status}'.",
        }
