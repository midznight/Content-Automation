export const ROLES = [
  "pm",
  "ceo",
  "strategist",
  "fact_checker",
  "animator",
  "animator_backup",
  "analyst",
  "social",
] as const;

export type Role = (typeof ROLES)[number];

export const WORKER_ROLES = new Set<Role>([
  "strategist",
  "fact_checker",
  "animator",
  "animator_backup",
  "analyst",
  "social",
]);

const ALL_ROLES = new Set<Role>(ROLES);

export const TASK_ROUTING_MATRIX: Record<string, { senders: ReadonlySet<string>; receivers: ReadonlySet<string> }> = {
  topic_candidates: { senders: new Set(["ceo"]), receivers: new Set(["strategist"]) },
  script: { senders: new Set(["ceo"]), receivers: new Set(["strategist"]) },
  fact_check: { senders: new Set(["ceo"]), receivers: new Set(["fact_checker"]) },
  render: { senders: new Set(["ceo"]), receivers: new Set(["animator", "animator_backup"]) },
  package: { senders: new Set(["ceo"]), receivers: new Set(["social"]) },
  metrics_report: { senders: new Set(["ceo", "system"]), receivers: new Set(["analyst"]) },
  daily_report: { senders: new Set(["system"]), receivers: new Set(["ceo"]) },
  echo: { senders: new Set(["ceo"]), receivers: WORKER_ROLES },
};

const TOOL_PERMISSIONS: Record<string, ReadonlySet<Role>> = {
  whoami: ALL_ROLES,
  inbox: ALL_ROLES,
  claim_task: new Set(ROLES.filter((role) => role !== "pm")),
  submit_result: new Set(ROLES.filter((role) => role !== "pm")),
  send_task: new Set<Role>(["ceo"]),
  list_tasks: ALL_ROLES,
  create_video: new Set<Role>(["ceo"]),
  request_upload: new Set(ROLES.filter((role) => role !== "pm")),
  post_artifact: new Set(ROLES.filter((role) => role !== "pm")),
  get_artifact: new Set(ROLES.filter((role) => role !== "pm")),
  request_approval: new Set<Role>(["ceo"]),
};

export const FORBIDDEN_TOOLS = new Set(["approve", "publish"]);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function validateToolAccess(role: Role, toolName: string): void {
  if (FORBIDDEN_TOOLS.has(toolName)) {
    throw new Error(
      `Tool '${toolName}' dilarang keras diakses lewat MCP. Persetujuan dan penerbitan hanya dapat dilakukan oleh PM manusia.`,
    );
  }

  const allowed = TOOL_PERMISSIONS[toolName];
  if (!allowed) {
    throw new Error(`Tool '${toolName}' tidak dikenal di hub.`);
  }

  if (!allowed.has(role)) {
    throw new Error(
      `Role '${role}' tidak diizinkan memanggil tool '${toolName}'. Hanya role berikut yang boleh: ${[...allowed].sort().join(", ")}.`,
    );
  }
}

export function validateTaskRoute(fromRole: string, toRole: string, taskType: string): void {
  const route = TASK_ROUTING_MATRIX[taskType];
  if (!route) {
    throw new Error(
      `Tipe tugas '${taskType}' tidak sah atau di luar matriks izin. Tipe yang sah: ${Object.keys(TASK_ROUTING_MATRIX).sort().join(", ")}.`,
    );
  }

  if (!route.senders.has(fromRole)) {
    throw new Error(
      `Role pengirim '${fromRole}' tidak berhak mengirim tugas bertipe '${taskType}'. Pengirim yang sah: ${[...route.senders].sort().join(", ")}.`,
    );
  }

  if (!route.receivers.has(toRole)) {
    throw new Error(
      `Tugas bertipe '${taskType}' tidak boleh dikirim ke role '${toRole}'. Penerima yang sah: ${[...route.receivers].sort().join(", ")}.`,
    );
  }
}