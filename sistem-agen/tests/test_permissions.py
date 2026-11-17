"""Comprehensive tests for role permissions matrix (docs/03 section 6, US-2, US-6)."""

import pytest

from hub.domain.permissions import (
    ALL_ROLES,
    FORBIDDEN_TOOLS,
    TASK_ROUTING_MATRIX,
    TOOL_PERMISSIONS,
    WORKER_ROLES,
    PermissionDeniedError,
    validate_send_task_route,
    validate_tool_access,
)


def test_task_routing_matrix_valid_combinations():
    for task_type, (allowed_senders, allowed_receivers) in TASK_ROUTING_MATRIX.items():
        for sender in allowed_senders:
            for receiver in allowed_receivers:
                # Should not raise
                validate_send_task_route(sender, receiver, task_type)


def test_task_routing_matrix_invalid_task_type():
    with pytest.raises(PermissionDeniedError) as exc_info:
        validate_send_task_route("ceo", "strategist", "unknown_task_type")
    err = str(exc_info.value)
    assert "tidak sah atau di luar matriks izin" in err
    assert "script" in err


def test_task_routing_matrix_unauthorized_sender():
    # strategist tries to send a script task
    with pytest.raises(PermissionDeniedError) as exc_info:
        validate_send_task_route("strategist", "fact_checker", "script")
    err = str(exc_info.value)
    assert "tidak berhak mengirim tugas" in err
    assert "ceo" in err


def test_task_routing_matrix_invalid_receiver_actionable_error():
    # CEO sends script to animator instead of strategist
    with pytest.raises(PermissionDeniedError) as exc_info:
        validate_send_task_route("ceo", "animator", "script")
    err = str(exc_info.value)
    assert "tidak boleh dikirim ke role 'animator'" in err
    assert "strategist" in err
    assert "Ubah parameter 'to'" in err


def test_workers_cannot_send_task():
    for role in WORKER_ROLES:
        with pytest.raises(PermissionDeniedError):
            validate_tool_access(role, "send_task")


def test_forbidden_tools_rejected_for_all_roles():
    for role in ALL_ROLES:
        for forbidden in FORBIDDEN_TOOLS:
            with pytest.raises(PermissionDeniedError) as exc_info:
                validate_tool_access(role, forbidden)
            assert "dilarang keras" in str(exc_info.value)


def test_each_tool_by_each_role_matches_matrix():
    for tool_name, allowed_roles in TOOL_PERMISSIONS.items():
        for role in ALL_ROLES:
            if role in allowed_roles:
                validate_tool_access(role, tool_name)
            else:
                with pytest.raises(PermissionDeniedError):
                    validate_tool_access(role, tool_name)
