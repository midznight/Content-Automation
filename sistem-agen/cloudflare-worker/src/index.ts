import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { isRole, ROLES, validateTaskRoute, validateToolAccess, type Role } from "./permissions";

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;
}

interface AgentRow {
  id: string;
  name: string;
  role: Role;
  vendor: string;
  key_hash: string;
  active: number;
  created_at: string;
  last_seen_at: string | null;
}

interface TaskRow {
  id: string;
  parent_id: string | null;
  video_id: string | null;
  type: string;
  title: string;
  payload: string;
  priority: string;
  from_agent: string;
  to_agent: string;
  status: string;
  blocked_reason: string | null;
  result: string | null;
  attempt: number;
  reassigned_from: string | null;
  created_at: string;
  claimed_at: string | null;
  updated_at: string;
  due_at: string | null;
}

interface EventRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  task_id: string | null;
  video_id: string | null;
  detail: string;
}

interface AuthenticatedAgent {
  id: string;
  name: string;
  role: Role;
  vendor: string;
  keyHash: string;
}

const MAX_PAYLOAD_BYTES = 256 * 1024;
const RATE_LIMIT_PER_MINUTE = 60;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim())),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = request.headers.get("x-api-key");
  return apiKey?.trim() || null;
}

async function authenticateAgent(
  request: Request,
  db: D1Database,
): Promise<AuthenticatedAgent | null> {
  const rawKey = getBearerToken(request);
  if (!rawKey) return null;

  const keyHash = await sha256(rawKey);
  const row = await db
    .prepare(
      "SELECT id, name, role, vendor, key_hash, active FROM agents WHERE key_hash = ? AND active = 1 LIMIT 1",
    )
    .bind(keyHash)
    .first<AgentRow>();

  if (!row || !isRole(row.role)) return null;

  const seenAt = nowIso();
  await db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").bind(seenAt, row.id).run();

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    vendor: row.vendor,
    keyHash,
  };
}

async function enforceRateLimit(db: D1Database, keyHash: string): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare(
      "INSERT INTO rate_limits (key_hash, window_started_at, request_count) VALUES (?, ?, 1) " +
        "ON CONFLICT(key_hash) DO UPDATE SET " +
        "request_count = CASE WHEN ? - rate_limits.window_started_at >= 60000 THEN 1 ELSE rate_limits.request_count + 1 END, " +
        "window_started_at = CASE WHEN ? - rate_limits.window_started_at >= 60000 THEN ? ELSE rate_limits.window_started_at END " +
        "RETURNING request_count",
    )
    .bind(keyHash, now, now, now, now)
    .first<{ request_count: number }>();

  return (row?.request_count ?? RATE_LIMIT_PER_MINUTE + 1) <= RATE_LIMIT_PER_MINUTE;
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function textResult(value: unknown) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function createServer(agent: AuthenticatedAgent, db: D1Database): McpServer {
  const server = new McpServer({
    name: "content-automation-hub",
    version: "1.0.0",
  });

  server.registerTool(
    "whoami",
    { description: "Mengembalikan identitas agen, role, vendor, dan status akun." },
    async () =>
      textResult({
        name: agent.name,
        role: agent.role,
        vendor: agent.vendor,
        status: "active",
      }),
  );

  server.registerTool(
    "inbox",
    {
      description: "Mengambil daftar tugas masuk dan notifikasi untuk role pemanggil.",
      inputSchema: {
        status: z.string().min(1).max(24).default("queued"),
        limit: z.number().int().min(1).max(100).default(10),
      },
    },
    async ({ status, limit }) => {
      validateToolAccess(agent.role, "inbox");
      const rows = await db
        .prepare(
          "SELECT * FROM tasks WHERE to_agent = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(agent.role, status, limit)
        .all<TaskRow>();

      const tasks = (rows.results ?? []).map((task) => ({
        task_id: task.id,
        video_id: task.video_id,
        type: task.type,
        title: task.title,
        from: task.from_agent,
        to: task.to_agent,
        priority: task.priority,
        status: task.status,
        attempt: task.attempt,
        created_at: task.created_at,
        due_at: task.due_at,
      }));

      let notifications: Array<Record<string, unknown>> = [];
      if (agent.role === "ceo") {
        const eventRows = await db
          .prepare(
            "SELECT * FROM events WHERE action IN ('result_ready', 'needs_reassign') ORDER BY ts DESC LIMIT ?",
          )
          .bind(limit)
          .all<EventRow>();
        notifications = (eventRows.results ?? []).map((event) => ({
          event_id: event.id,
          action: event.action,
          actor: event.actor,
          task_id: event.task_id,
          video_id: event.video_id,
          timestamp: event.ts,
          detail: parseJson(event.detail, {}),
        }));
      }

      return textResult({ role: agent.role, tasks, notifications });
    },
  );

  server.registerTool(
    "claim_task",
    {
      description: "Mengklaim tugas berstatus queued untuk dikerjakan.",
      inputSchema: { task_id: z.string().min(1).max(64) },
    },
    async ({ task_id }) => {
      validateToolAccess(agent.role, "claim_task");
      const task = await db
        .prepare("SELECT * FROM tasks WHERE id = ? LIMIT 1")
        .bind(task_id)
        .first<TaskRow>();

      if (!task) return toolError("Tugas dengan ID '" + task_id + "' tidak ditemukan.");
      if (task.to_agent !== agent.role && agent.role !== "ceo") {
        return toolError(
          "Tugas '" + task_id + "' ditujukan untuk role '" + task.to_agent + "', bukan '" + agent.role + "'.",
        );
      }
      if (task.status !== "queued") {
        return toolError(
          "Tugas '" + task_id + "' tidak dapat diambil karena berstatus '" + task.status + "'.",
        );
      }

      const claimedAt = nowIso();
      const batch = await db.batch([
        db
          .prepare(
            "UPDATE tasks SET status = 'claimed', claimed_at = ?, updated_at = ? " +
              "WHERE id = ? AND status = 'queued' AND (to_agent = ? OR ? = 'ceo')",
          )
          .bind(claimedAt, claimedAt, task_id, agent.role, agent.role),
        db
          .prepare(
            "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
              "SELECT ?, ?, 'task_status_claimed', id, video_id, ? FROM tasks " +
              "WHERE id = ? AND status = 'claimed' AND claimed_at = ? AND changes() = 1",
          )
          .bind(
            claimedAt,
            agent.name,
            JSON.stringify({ previous_status: "queued", new_status: "claimed" }),
            task_id,
            claimedAt,
          ),
      ]);

      if ((batch[0]?.meta?.changes ?? 0) !== 1) {
        return toolError("Tugas sudah diklaim atau berubah status oleh agen lain. Muat ulang inbox.");
      }

      return textResult({
        task_id: task.id,
        parent_id: task.parent_id,
        video_id: task.video_id,
        type: task.type,
        title: task.title,
        from: task.from_agent,
        to: task.to_agent,
        priority: task.priority,
        status: "claimed",
        attempt: task.attempt,
        reassigned_from: task.reassigned_from,
        created_at: task.created_at,
        claimed_at: claimedAt,
        due_at: task.due_at,
        payload: parseJson(task.payload, {}),
      });
    },
  );

  server.registerTool(
    "submit_result",
    {
      description: "Mengirimkan hasil pengerjaan tugas (done, blocked, atau failed).",
      inputSchema: {
        task_id: z.string().min(1).max(64),
        status: z.enum(["done", "blocked", "failed"]),
        result: z.record(z.string(), z.unknown()).optional(),
        blocked_reason: z.string().max(64).optional(),
      },
    },
    async ({ task_id, status, result, blocked_reason }) => {
      validateToolAccess(agent.role, "submit_result");
      if (status === "blocked" && !blocked_reason) {
        return toolError("blocked_reason wajib diisi saat status 'blocked'.");
      }

      const task = await db
        .prepare("SELECT * FROM tasks WHERE id = ? LIMIT 1")
        .bind(task_id)
        .first<TaskRow>();

      if (!task) return toolError("Tugas dengan ID '" + task_id + "' tidak ditemukan.");
      if (task.to_agent !== agent.role && agent.role !== "ceo") {
        return toolError("Anda bukan penerima tugas '" + task_id + "'.");
      }
      if (task.status !== "claimed") {
        return toolError(
          "Tugas '" + task_id + "' berstatus '" + task.status + "', bukan 'claimed'.",
        );
      }

      const updatedAt = nowIso();
      const notificationAction =
        task.type === "render" &&
        (status === "failed" ||
          (status === "blocked" && (blocked_reason === "limit" || blocked_reason === "failed")))
          ? "needs_reassign"
          : "result_ready";

      const batch = await db.batch([
        db
          .prepare(
            "UPDATE tasks SET status = ?, result = ?, blocked_reason = ?, updated_at = ? " +
              "WHERE id = ? AND status = 'claimed' AND (to_agent = ? OR ? = 'ceo')",
          )
          .bind(
            status,
            JSON.stringify(result ?? {}),
            blocked_reason ?? null,
            updatedAt,
            task_id,
            agent.role,
            agent.role,
          ),
        db
          .prepare(
            "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
              "SELECT ?, ?, 'task_status_' || ?, id, video_id, ? FROM tasks " +
              "WHERE id = ? AND status = ? AND updated_at = ? AND changes() = 1",
          )
          .bind(
            updatedAt,
            agent.name,
            status,
            JSON.stringify({
              previous_status: "claimed",
              new_status: status,
              blocked_reason: blocked_reason ?? null,
            }),
            task_id,
            status,
            updatedAt,
          ),
        db
          .prepare(
            "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
              "SELECT ?, ?, ?, id, video_id, ? FROM tasks " +
              "WHERE id = ? AND status = ? AND updated_at = ? AND changes() = 1",
          )
          .bind(
            updatedAt,
            agent.name,
            notificationAction,
            JSON.stringify({
              task_id,
              task_type: task.type,
              status,
              blocked_reason: blocked_reason ?? null,
            }),
            task_id,
            status,
            updatedAt,
          ),
      ]);

      if ((batch[0]?.meta?.changes ?? 0) !== 1) {
        return toolError("Tugas sudah berubah status. Muat ulang daftar tugas sebelum mengirim hasil.");
      }

      return textResult({
        task_id,
        status,
        notification: notificationAction,
        message: "Hasil untuk tugas '" + task_id + "' berhasil disimpan.",
      });
    },
  );

  server.registerTool(
    "send_task",
    {
      description: "Mengirimkan tugas baru dari CEO ke agen pekerja yang berizin.",
      inputSchema: {
        to: z.string().min(1).max(32),
        type: z.string().min(1).max(32),
        title: z.string().min(1).max(255),
        payload: z.record(z.string(), z.unknown()),
        video_id: z.string().max(64).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        due_at: z.string().optional(),
        reassigned_from: z.string().max(64).optional(),
      },
    },
    async ({ to, type, title, payload, video_id, priority, due_at, reassigned_from }) => {
      validateToolAccess(agent.role, "send_task");
      try {
        validateTaskRoute(agent.role, to, type);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : "Rute tugas tidak sah.");
      }

      const payloadText = JSON.stringify(payload);
      if (new TextEncoder().encode(payloadText).byteLength > MAX_PAYLOAD_BYTES) {
        return toolError("Ukuran payload melebihi batas maksimal 256 KB.");
      }

      let dueAt: string | null = null;
      if (due_at) {
        const parsed = Date.parse(due_at);
        if (!Number.isFinite(parsed)) {
          return toolError("Format due_at tidak valid. Gunakan format ISO 8601.");
        }
        dueAt = new Date(parsed).toISOString();
      }

      const createdAt = nowIso();
      const taskId = newId("tsk_");
      const statements: D1PreparedStatement[] = [];

      if (reassigned_from) {
        statements.push(
          db
            .prepare(
              "UPDATE tasks SET status = 'superseded', updated_at = ? " +
                "WHERE id = ? AND status IN ('blocked', 'failed', 'stale')",
            )
            .bind(createdAt, reassigned_from),
        );
        statements.push(
          db
            .prepare(
              "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
                "SELECT ?, ?, 'task_status_superseded', id, video_id, ? FROM tasks " +
                "WHERE id = ? AND status = 'superseded' AND updated_at = ? AND changes() = 1",
            )
            .bind(
              createdAt,
              agent.name,
              JSON.stringify({ previous_status: "blocked_or_failed_or_stale", new_status: "superseded", reassigned_to_role: to }),
              reassigned_from,
              createdAt,
            ),
        );
      }

      statements.push(
        db
          .prepare(
            "INSERT INTO tasks (id, video_id, type, title, payload, priority, from_agent, to_agent, status, " +
              "attempt, reassigned_from, created_at, updated_at, due_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, ?, ?)",
          )
          .bind(
            taskId,
            video_id ?? null,
            type,
            title,
            payloadText,
            priority,
            agent.role,
            to,
            reassigned_from ?? null,
            createdAt,
            createdAt,
            dueAt,
          ),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
              "SELECT ?, ?, 'send_task', id, video_id, ? FROM tasks WHERE id = ?",
          )
          .bind(
            createdAt,
            agent.name,
            JSON.stringify({ to, type, title, priority }),
            taskId,
          ),
      );

      await db.batch(statements);
      return textResult({
        task_id: taskId,
        status: "queued",
        to,
        type,
        message: "Tugas '" + title + "' berhasil dikirim ke role '" + to + "'.",
      });
    },
  );

  server.registerTool(
    "list_tasks",
    {
      description: "Melihat daftar tugas dengan filter opsional.",
      inputSchema: {
        status: z.string().max(24).optional(),
        video_id: z.string().max(64).optional(),
        type: z.string().max(32).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ status, video_id, type, limit }) => {
      validateToolAccess(agent.role, "list_tasks");
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (agent.role !== "ceo") {
        clauses.push("(to_agent = ? OR from_agent = ?)");
        params.push(agent.role, agent.role);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      if (video_id) {
        clauses.push("video_id = ?");
        params.push(video_id);
      }
      if (type) {
        clauses.push("type = ?");
        params.push(type);
      }

      const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
      params.push(limit);
      const rows = await db
        .prepare("SELECT * FROM tasks" + where + " ORDER BY created_at DESC LIMIT ?")
        .bind(...params)
        .all<TaskRow>();

      return textResult({
        tasks: (rows.results ?? []).map((task) => ({
          task_id: task.id,
          video_id: task.video_id,
          type: task.type,
          title: task.title,
          from: task.from_agent,
          to: task.to_agent,
          priority: task.priority,
          status: task.status,
          blocked_reason: task.blocked_reason,
          attempt: task.attempt,
          reassigned_from: task.reassigned_from,
          created_at: task.created_at,
          claimed_at: task.claimed_at,
          due_at: task.due_at,
        })),
      });
    },
  );

  return server;
}

function adminAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const supplied =
    request.headers.get("x-admin-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return constantTimeEqual(supplied, env.ADMIN_TOKEN);
}

async function adminRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (!adminAuthorized(request, env)) {
    return jsonResponse({ error: "Admin authorization required." }, 401);
  }

  if (request.method === "GET" && url.pathname === "/admin/agents") {
    const rows = await env.DB
      .prepare(
        "SELECT id, name, role, vendor, active, created_at, last_seen_at FROM agents ORDER BY name",
      )
      .all<Omit<AgentRow, "key_hash">>();
    return jsonResponse({ agents: rows.results ?? [] });
  }

  if (request.method === "POST" && url.pathname === "/admin/agents") {
    if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024) {
      return jsonResponse({ error: "Payload too large." }, 413);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role = body.role;
    const vendor =
      typeof body.vendor === "string" && body.vendor.trim()
        ? body.vendor.trim().slice(0, 32)
        : "manual";

    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(name) || !isRole(role)) {
      return jsonResponse(
        { error: "name harus 2–64 karakter alfanumerik/dot/underscore/hyphen dan role harus valid.", valid_roles: ROLES },
        400,
      );
    }

    const rawKey = "agt_live_" + randomBase64Url(32);
    const keyHash = await sha256(rawKey);
    const id = newId("agt_");
    const createdAt = nowIso();

    try {
      await env.DB.batch([
        env.DB
          .prepare(
            "INSERT INTO agents (id, name, role, vendor, key_hash, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
          )
          .bind(id, name, role, vendor, keyHash, createdAt),
        env.DB
          .prepare(
            "INSERT INTO events (ts, actor, action, detail) VALUES (?, 'admin', 'create_agent', ?)",
          )
          .bind(createdAt, JSON.stringify({ name, role, vendor, agent_id: id })),
      ]);
    } catch {
      return jsonResponse({ error: "Gagal membuat agen. Pastikan nama agen belum digunakan." }, 409);
    }

    return jsonResponse(
      {
        agent: { id, name, role, vendor, active: true, created_at: createdAt },
        api_key: rawKey,
        warning: "Kunci hanya ditampilkan satu kali. Simpan di pengelola rahasia agen.",
      },
      201,
    );
  }

  const match = url.pathname.match(/^\/admin\/agents\/([^/]+)\/(revoke|rotate)$/);
  if (request.method === "POST" && match) {
    const name = decodeURIComponent(match[1]);
    const action = match[2];
    const existing = await env.DB
      .prepare("SELECT id, name FROM agents WHERE name = ? LIMIT 1")
      .bind(name)
      .first<{ id: string; name: string }>();

    if (!existing) return jsonResponse({ error: "Agen tidak ditemukan." }, 404);

    const changedAt = nowIso();
    if (action === "revoke") {
      const batch = await env.DB.batch([
        env.DB.prepare("UPDATE agents SET active = 0 WHERE id = ?").bind(existing.id),
        env.DB
          .prepare(
            "INSERT INTO events (ts, actor, action, detail) " +
              "SELECT ?, 'admin', 'revoke_agent', ? WHERE changes() = 1",
          )
          .bind(changedAt, JSON.stringify({ name, agent_id: existing.id })),
      ]);
      if ((batch[0]?.meta?.changes ?? 0) !== 1) {
        return jsonResponse({ error: "Agen berubah saat permintaan diproses." }, 409);
      }
      return jsonResponse({ ok: true, name, active: false });
    }

    const rawKey = "agt_live_" + randomBase64Url(32);
    const keyHash = await sha256(rawKey);
    const batch = await env.DB.batch([
      env.DB
        .prepare("UPDATE agents SET key_hash = ?, active = 1 WHERE id = ?")
        .bind(keyHash, existing.id),
      env.DB
        .prepare(
          "INSERT INTO events (ts, actor, action, detail) " +
            "SELECT ?, 'admin', 'rotate_key', ? WHERE changes() = 1",
        )
        .bind(changedAt, JSON.stringify({ name, agent_id: existing.id })),
    ]);
    if ((batch[0]?.meta?.changes ?? 0) !== 1) {
      return jsonResponse({ error: "Agen berubah saat permintaan diproses." }, 409);
    }
    return jsonResponse({
      ok: true,
      name,
      api_key: rawKey,
      warning: "Kunci baru hanya ditampilkan satu kali. Perbarui konektor agen.",
    });
  }

  return jsonResponse({ error: "Admin route not found." }, 404);
}

function randomBase64Url(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      try {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return jsonResponse({
          status: "ok",
          service: "content-automation-hub",
          database: "healthy",
        });
      } catch {
        return jsonResponse({ status: "error", database: "unavailable" }, 503);
      }
    }

    if (url.pathname.startsWith("/admin/")) {
      return adminRoute(request, env, url);
    }

    if (url.pathname !== "/mcp") {
      return jsonResponse({ error: "Not found." }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "MCP endpoint accepts POST requests only." }, 405);
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return jsonResponse({ error: "Payload melebihi batas 256 KB." }, 413);
    }

    const agent = await authenticateAgent(request, env.DB);
    if (!agent) {
      return jsonResponse({ error: "API key agen tidak valid, dicabut, atau tidak ditemukan." }, 401);
    }

    if (!(await enforceRateLimit(env.DB, agent.keyHash))) {
      return jsonResponse(
        { error: "Batas 60 permintaan per menit per agen terlampaui." },
        429,
      );
    }

    const handler = createMcpHandler(() => createServer(agent, env.DB));
    return handler(request, env, ctx as never);
  },
};