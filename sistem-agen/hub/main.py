"""FastAPI application entrypoint hosting MCP streamable HTTP server."""

from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from mcp.server.transport_security import TransportSecuritySettings

from hub.db.session import init_db
from hub.mcp_server import mcp_server
from hub.middleware import LimitsMiddleware

import os


def _csv_setting(name: str, default: tuple[str, ...] = ()) -> list[str]:
    """Read a comma-separated allowlist from the environment."""
    raw_value = os.getenv(name)
    values = raw_value.split(",") if raw_value is not None else default
    return [value.strip() for value in values if value.strip()]


security_settings = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=_csv_setting(
        "MCP_ALLOWED_HOSTS",
        ("localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]:*"),
    ),
    allowed_origins=_csv_setting("MCP_ALLOWED_ORIGINS"),
)
mcp_app = mcp_server.streamable_http_app(
    streamable_http_path="/mcp",
    transport_security=security_settings,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize DB and MCP streamable HTTP session manager."""
    init_db()
    mgr = mcp_server.session_manager
    if not getattr(mgr, "_has_started", False):
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(mgr.run())
            yield
    else:
        yield


app = FastAPI(
    title="Hub Multi-Agen Produksi TikTok",
    description="Hub MCP self-hosted untuk produksi video TikTok",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(LimitsMiddleware)


@app.get("/health")
def health_check():
    """Health check endpoint verifying DB accessibility."""
    from fastapi.responses import JSONResponse
    from sqlalchemy import text

    from hub.db.session import SessionLocal

    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1;"))
        return {"status": "ok", "service": "hub-mcp", "database": "healthy"}
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "service": "hub-mcp", "database": str(exc)},
        )


# Mount MCP sub-app under root so /mcp is directly routed
app.mount("/", mcp_app)
