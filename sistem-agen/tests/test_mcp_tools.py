"""Tests for the 6 core MCP tools."""

from unittest.mock import MagicMock

import pytest
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import hub.db.session as session_module
from hub.auth import generate_agent_key, hash_key
from hub.db.base import Base
from hub.db.models import Agent
from hub.tools.claim_task import handle_claim_task
from hub.tools.inbox import handle_inbox
from hub.tools.list_tasks import handle_list_tasks
from hub.tools.send_task import handle_send_task
from hub.tools.submit_result import handle_submit_result
from hub.tools.whoami import handle_whoami


@pytest.fixture
def test_env(tmp_path, monkeypatch):
    db_file = tmp_path / "test_tools.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setenv("DATABASE_URL", db_url)

    engine = create_engine(db_url)
    Base.metadata.create_all(bind=engine)
    session_cls = sessionmaker(bind=engine)

    monkeypatch.setattr(session_module, "engine", engine)
    monkeypatch.setattr(session_module, "SessionLocal", session_cls)

    # Create test agents: ceo and strategist
    db = session_cls()
    ceo_key = generate_agent_key()
    strat_key = generate_agent_key()
    anim_key = generate_agent_key()

    ceo_agent = Agent(name="cue_ceo", role="ceo", vendor="cue", key_hash=hash_key(ceo_key))
    strat_agent = Agent(
        name="muse_strat", role="strategist", vendor="muse", key_hash=hash_key(strat_key)
    )
    anim_agent = Agent(name="cue_anim", role="animator", vendor="cue", key_hash=hash_key(anim_key))

    db.add_all([ceo_agent, strat_agent, anim_agent])
    db.commit()
    db.close()

    def make_context(key: str):
        ctx = MagicMock()
        ctx.headers = {"Authorization": f"Bearer {key}"}
        return ctx

    return {
        "ceo_ctx": make_context(ceo_key),
        "strat_ctx": make_context(strat_key),
        "anim_ctx": make_context(anim_key),
        "engine": engine,
        "session_cls": session_cls,
    }


def test_whoami_tool(test_env):
    res = handle_whoami(test_env["ceo_ctx"])
    assert res["name"] == "cue_ceo"
    assert res["role"] == "ceo"
    assert res["status"] == "active"


def test_send_task_and_inbox_and_claim_and_submit(test_env):
    # 1. CEO sends a script task to strategist
    send_res = handle_send_task(
        ctx=test_env["ceo_ctx"],
        to="strategist",
        type="script",
        title="Skrip Fakta Laut",
        payload={"topic": "Laut Dalam"},
        priority="high",
    )
    assert send_res["status"] == "queued"
    task_id = send_res["task_id"]

    # 2. Strategist checks inbox
    inbox_res = handle_inbox(test_env["strat_ctx"])
    assert len(inbox_res["tasks"]) == 1
    assert inbox_res["tasks"][0]["task_id"] == task_id

    # 3. Strategist claims the task
    claim_res = handle_claim_task(test_env["strat_ctx"], task_id=task_id)
    assert claim_res["status"] == "claimed"
    assert claim_res["payload"] == {"topic": "Laut Dalam"}

    # Claiming again by anyone fails
    with pytest.raises(ToolError) as exc_info:
        handle_claim_task(test_env["strat_ctx"], task_id=task_id)
    assert "tidak dapat diambil" in str(exc_info.value)

    # 4. Strategist submits result
    submit_res = handle_submit_result(
        ctx=test_env["strat_ctx"],
        task_id=task_id,
        status="done",
        result={"hook": "Tahukah kamu di palung laut...", "beats": []},
    )
    assert submit_res["status"] == "done"
    assert submit_res["notification"] == "result_ready"

    # 5. CEO checks inbox and sees result_ready notification
    ceo_inbox = handle_inbox(test_env["ceo_ctx"])
    assert any(n["action"] == "result_ready" for n in ceo_inbox["notifications"])


def test_list_tasks_visibility(test_env):
    # CEO creates a task for strategist and another for animator
    t1 = handle_send_task(
        ctx=test_env["ceo_ctx"],
        to="strategist",
        type="topic_candidates",
        title="Topik Minggu Ini",
        payload={},
    )["task_id"]

    t2 = handle_send_task(
        ctx=test_env["ceo_ctx"],
        to="animator",
        type="render",
        title="Render Video 1",
        payload={},
    )["task_id"]

    # CEO sees all tasks
    ceo_list = handle_list_tasks(test_env["ceo_ctx"])
    ceo_task_ids = {t["task_id"] for t in ceo_list["tasks"]}
    assert {t1, t2}.issubset(ceo_task_ids)

    # Strategist only sees t1, not t2
    strat_list = handle_list_tasks(test_env["strat_ctx"])
    strat_task_ids = {t["task_id"] for t in strat_list["tasks"]}
    assert t1 in strat_task_ids
    assert t2 not in strat_task_ids
