"""whoami tool: Returns caller identity, role, and account status."""

from typing import Any

from mcp.server.mcpserver import Context

from hub.db import session as db_session
from hub.tools.common import get_authenticated_agent


def handle_whoami(ctx: Context) -> dict[str, Any]:
    """Return calling agent name, role, and account status."""
    with db_session.SessionLocal() as db:
        agent = get_authenticated_agent(ctx, db, "whoami")
        return {
            "name": agent.name,
            "role": agent.role,
            "vendor": agent.vendor,
            "status": "active" if agent.active else "revoked",
        }
