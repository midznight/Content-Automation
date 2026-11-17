"""Role permissions matrix and enforcement."""

WORKER_ROLES = {
    "strategist",
    "fact_checker",
    "animator",
    "animator_backup",
    "analyst",
    "social",
}

ALL_ROLES = {"pm", "ceo"} | WORKER_ROLES

# Task routing matrix: task_type -> (allowed_senders, allowed_receivers)
TASK_ROUTING_MATRIX: dict[str, tuple[set[str], set[str]]] = {
    "topic_candidates": ({"ceo"}, {"strategist"}),
    "script": ({"ceo"}, {"strategist"}),
    "fact_check": ({"ceo"}, {"fact_checker"}),
    "render": ({"ceo"}, {"animator", "animator_backup"}),
    "package": ({"ceo"}, {"social"}),
    "metrics_report": ({"ceo", "system"}, {"analyst"}),
    "daily_report": ({"system"}, {"ceo"}),
    "echo": ({"ceo"}, WORKER_ROLES),
}

TOOL_PERMISSIONS: dict[str, set[str]] = {
    "whoami": ALL_ROLES,
    "inbox": ALL_ROLES,
    "claim_task": ALL_ROLES - {"pm"},
    "submit_result": ALL_ROLES - {"pm"},
    "send_task": {"ceo", "system"},
    "list_tasks": ALL_ROLES,
    "request_upload": WORKER_ROLES,
    "post_artifact": WORKER_ROLES | {"ceo"},
    "get_artifact": ALL_ROLES,
    "request_approval": {"ceo"},
}

FORBIDDEN_TOOLS = {"approve", "publish"}


class PermissionDeniedError(Exception):
    """Raised when an agent attempts an unauthorized action."""

    pass


def validate_tool_access(role: str, tool_name: str) -> None:
    """Validate that the agent's role is allowed to call the tool."""
    if tool_name in FORBIDDEN_TOOLS:
        raise PermissionDeniedError(
            f"Tool '{tool_name}' dilarang keras diakses lewat MCP. "
            "Persetujuan dan penerbitan hanya dapat dilakukan oleh PM manusia."
        )

    allowed = TOOL_PERMISSIONS.get(tool_name)
    if allowed is None:
        raise PermissionDeniedError(f"Tool '{tool_name}' tidak dikenal di hub.")

    if role not in allowed:
        raise PermissionDeniedError(
            f"Role '{role}' tidak diizinkan memanggil tool '{tool_name}'. "
            f"Hanya role berikut yang boleh: {', '.join(sorted(allowed))}."
        )


def validate_send_task_route(from_role: str, to_role: str, task_type: str) -> None:
    """Validate task routing according to docs/03 section 6."""
    if task_type not in TASK_ROUTING_MATRIX:
        valid_types = ", ".join(sorted(TASK_ROUTING_MATRIX.keys()))
        raise PermissionDeniedError(
            f"Tipe tugas '{task_type}' tidak sah atau di luar matriks izin. "
            f"Gunakan salah satu tipe tugas yang sah: {valid_types}."
        )

    allowed_senders, allowed_receivers = TASK_ROUTING_MATRIX[task_type]

    if from_role not in allowed_senders:
        raise PermissionDeniedError(
            f"Role pengirim '{from_role}' tidak berhak mengirim tugas bertipe '{task_type}'. "
            f"Pengirim yang sah adalah: {', '.join(sorted(allowed_senders))}."
        )

    if to_role not in allowed_receivers:
        raise PermissionDeniedError(
            f"Tugas bertipe '{task_type}' tidak boleh dikirim ke role '{to_role}'. "
            f"Penerima yang sah adalah: {', '.join(sorted(allowed_receivers))}. "
            "Ubah parameter 'to' ke role penerima yang benar."
        )
