"""MCP Server initialization and tool registrations."""

from typing import Any

from mcp.server.mcpserver import Context, MCPServer

from hub.tools.claim_task import handle_claim_task
from hub.tools.inbox import handle_inbox
from hub.tools.list_tasks import handle_list_tasks
from hub.tools.send_task import handle_send_task
from hub.tools.submit_result import handle_submit_result
from hub.tools.whoami import handle_whoami

mcp_server = MCPServer(
    name="hub",
    title="Hub Multi-Agen Produksi TikTok",
    description="Hub MCP self-hosted untuk orkestrasi pipeline produksi video TikTok",
    version="1.0.0",
)


@mcp_server.tool(
    name="whoami",
    description="Mengembalikan identitas agen, role, vendor, dan status akun.",
)
def whoami(ctx: Context) -> dict[str, Any]:
    return handle_whoami(ctx)


@mcp_server.tool(
    name="inbox",
    description="Mengambil daftar tugas masuk dan notifikasi untuk role pemanggil.",
)
def inbox(ctx: Context, status: str = "queued", limit: int = 10) -> dict[str, Any]:
    return handle_inbox(ctx, status=status, limit=limit)


@mcp_server.tool(
    name="claim_task",
    description="Mengklaim tugas berstatus queued untuk dikerjakan.",
)
def claim_task(ctx: Context, task_id: str) -> dict[str, Any]:
    return handle_claim_task(ctx, task_id=task_id)


@mcp_server.tool(
    name="submit_result",
    description="Mengirimkan hasil pengerjaan tugas (done, blocked, atau failed).",
)
def submit_result(
    ctx: Context,
    task_id: str,
    status: str,
    result: dict[str, Any] | None = None,
    blocked_reason: str | None = None,
) -> dict[str, Any]:
    return handle_submit_result(
        ctx,
        task_id=task_id,
        status=status,
        result=result,
        blocked_reason=blocked_reason,
    )


@mcp_server.tool(
    name="send_task",
    description="Mengirimkan tugas baru dari CEO ke agen pekerja yang berizin.",
)
def send_task(
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
    return handle_send_task(
        ctx,
        to=to,
        type=type,
        title=title,
        payload=payload,
        video_id=video_id,
        priority=priority,
        due_at=due_at,
        reassigned_from=reassigned_from,
    )


@mcp_server.tool(
    name="list_tasks",
    description="Melihat daftar tugas dengan filter opsional.",
)
def list_tasks(
    ctx: Context,
    status: str | None = None,
    video_id: str | None = None,
    type: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    return handle_list_tasks(ctx, status=status, video_id=video_id, type=type, limit=limit)
