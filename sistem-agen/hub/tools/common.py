"""Common helpers for MCP tools."""

from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy.orm import Session

from hub.auth import authenticate_agent
from hub.db.models import Agent
from hub.domain.permissions import PermissionDeniedError, validate_tool_access


def get_authenticated_agent(ctx: Context, db: Session, tool_name: str) -> Agent:
    """Authenticate agent from request headers and validate tool access permissions."""
    headers = ctx.headers or {}
    agent = authenticate_agent(db, headers)
    if not agent:
        raise ToolError(
            "Autentikasi gagal: Kunci API agen tidak valid, dicabut, "
            "atau header otentikasi tidak ditemukan. "
            "Sediakan header 'Authorization: Bearer <kunci>' atau 'X-API-Key: <kunci>'."
        )

    try:
        validate_tool_access(agent.role, tool_name)
    except PermissionDeniedError as exc:
        raise ToolError(f"Izin ditolak: {exc}") from exc

    return agent
