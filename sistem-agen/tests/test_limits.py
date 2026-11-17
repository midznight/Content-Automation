"""Tests for payload limit (256 KB) and rate limiting (60 req/min/agent)."""

from fastapi.testclient import TestClient

from hub.auth import generate_agent_key
from hub.main import create_app
from hub.middleware import MAX_PAYLOAD_BYTES, LimitsMiddleware


def test_payload_size_limit():
    LimitsMiddleware.reset_limits()
    with TestClient(create_app()) as client:
        # 1. Payload within limit sent to /mcp
        small_body = b'{"jsonrpc": "2.0", "method": "ping", "id": 1}'
        r1 = client.post(
            "/mcp",
            content=small_body,
            headers={
                "Content-Length": str(len(small_body)),
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
        )
        # Not a 413 Payload Too Large
        assert r1.status_code != 413

        # 2. Payload exceeding 256 KB
        large_size = MAX_PAYLOAD_BYTES + 100
        large_body = b"x" * large_size
        r2 = client.post(
            "/mcp",
            content=large_body,
            headers={"Content-Length": str(large_size), "Content-Type": "application/json"},
        )
        assert r2.status_code == 413
        assert "melebihi batas" in r2.json()["error"]


def test_rate_limit_per_agent():
    LimitsMiddleware.reset_limits()
    agent_a_key = generate_agent_key()
    agent_b_key = generate_agent_key()

    with TestClient(create_app()) as client:
        headers_a = {"Authorization": f"Bearer {agent_a_key}"}
        headers_b = {"Authorization": f"Bearer {agent_b_key}"}

        # Send 60 requests for Agent A
        for _ in range(60):
            res = client.get("/health", headers=headers_a)
            assert res.status_code == 200

        # The 61st request for Agent A must be rejected with 429
        res_blocked = client.get("/health", headers=headers_a)
        assert res_blocked.status_code == 429
        assert "terlampaui" in res_blocked.json()["error"]
        assert res_blocked.headers.get("Retry-After") == "60"

        # Agent B has independent rate limit and should still succeed
        res_b = client.get("/health", headers=headers_b)
        assert res_b.status_code == 200


def test_mcp_host_allowlist_accepts_expected_host_and_rejects_other_hosts():
    LimitsMiddleware.reset_limits()
    body = b'{"jsonrpc": "2.0", "method": "ping", "id": 1}'
    common_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    with TestClient(create_app()) as client:
        allowed = client.post(
            "/mcp",
            content=body,
            headers={**common_headers, "Host": "localhost"},
        )
        blocked = client.post(
            "/mcp",
            content=body,
            headers={**common_headers, "Host": "attacker.example"},
        )

    assert allowed.status_code != 421
    assert blocked.status_code == 421
