import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { evaluateFactCheckGate, validatePackageResult, validateScriptResult } from "./pipeline";
import { isRole, ROLES, validateTaskRoute, validateToolAccess, type Role } from "./permissions";
import { formatTelegramAgentReply, parseTelegramCommand } from "./telegram";
import { ManusApiError, sendManusAgentMessage } from "./manus";

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

interface R2Object {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
  size: number;
  checksums?: { sha256?: ArrayBuffer };
}
interface R2PutResult { size: number; checksums?: { sha256?: ArrayBuffer } }
interface R2Bucket {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      customMetadata?: Record<string, string>;
      sha256?: ArrayBuffer | string;
    },
  ): Promise<R2PutResult | null>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
}
interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  ADMIN_TOKEN?: string;
  PM_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_PM_CHAT_ID?: string;
  TELEGRAM_GROUP_CHAT_ID?: string;
  TELEGRAM_PM_USER_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  MANUS_API_KEY?: string;
  MANUS_CEO_TASK_ID?: string;
  MANUS_ANIMATOR_TASK_ID?: string;
}
interface UploadSessionRow {
  id: string; task_id: string; video_id: string; agent_id: string; kind: string; file_name: string;
  content_type: string; expected_size: number; expected_sha256: string; object_key: string; token_hash: string;
  status: string; sha256: string | null; size_bytes: number | null; expires_at: string;
}
interface ArtifactAccessTokenRow {
  id: string; artifact_id: string; agent_id: string; token_hash: string;
  expires_at: string; used_at: string | null;
}
interface ApprovalRow {
  id: string; video_id: string; stage: string; requested_at: string; decided_at: string | null;
  decision: string | null; decided_by: string | null; note: string | null; summary: string | null; requested_by: string | null;
}
interface VideoRow {
  id: string; topic: string; pillar: string | null; stage: string; created_at: string;
  updated_at: string | null; published_at: string | null; tiktok_url: string | null;
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
const MAX_ARTIFACT_BYTES = 90 * 1024 * 1024;
const UPLOAD_TTL_MS = 15 * 60 * 1000;
const RATE_LIMIT_PER_MINUTE = 60;
const ALLOWED_ARTIFACT_KINDS = new Set(["video_mp4", "subtitle_srt", "cover_png", "storyboard", "source_report", "caption_pack"]);
const ALLOWED_CONTENT_TYPES = new Set(["video/mp4", "text/plain", "text/srt", "application/x-subrip", "image/png", "image/jpeg", "application/pdf", "application/json"]);
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
function pmAuthorized(request: Request, env: Env): boolean {
  if (!env.PM_TOKEN) return false;
  const supplied = request.headers.get("x-pm-token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return constantTimeEqual(supplied, env.PM_TOKEN);
}
function safeFileName(value: string): string {
  const cleaned = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "artifact.bin";
}
function hexToBytes(hex: string): ArrayBuffer {
  const normalized = hex.toLowerCase();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes.buffer;
}
function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function telegramGroupChatId(env: Env): Promise<string | null> {
  if (env.TELEGRAM_GROUP_CHAT_ID) return env.TELEGRAM_GROUP_CHAT_ID;
  try {
    const setting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'telegram_group_chat_id' LIMIT 1").first<{ value: string }>();
    return setting?.value ?? null;
  } catch {
    return null;
  }
}
async function sendTelegramMessage(env: Env, chatId: string, message: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message.slice(0, 3900), disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    });
    if (!response.ok) console.error(JSON.stringify({ event: "telegram_notify_failed", status: response.status }));
  } catch {
    console.error(JSON.stringify({ event: "telegram_notify_failed", reason: "network_error" }));
  }
}
async function notifyPM(env: Env, message: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const chatId = await telegramGroupChatId(env) ?? env.TELEGRAM_PM_CHAT_ID;
  if (!chatId) return;
  await sendTelegramMessage(env, chatId, message, replyMarkup);
}

async function dispatchCueTask(env: Env, hubTaskId: string): Promise<void> {
  const dispatch = await env.DB.prepare(
    "SELECT d.role, d.status, d.attempts, t.title, t.status AS task_status " +
      "FROM agent_dispatches d JOIN tasks t ON t.id = d.task_id WHERE d.task_id = ? LIMIT 1",
  ).bind(hubTaskId).first<{
    role: string; status: string; attempts: number; title: string; task_status: string;
  }>();
  if (!dispatch || dispatch.task_status !== "queued") return;
  if (dispatch.status !== "pending" && dispatch.status !== "retry") return;
  if (dispatch.role !== "ceo" && dispatch.role !== "animator") {
    await env.DB.prepare(
      "UPDATE agent_dispatches SET status = 'failed', last_error = ?, updated_at = ? WHERE task_id = ? AND status IN ('pending', 'retry')",
    ).bind("Role Cue belum didukung oleh adapter.", nowIso(), hubTaskId).run();
    return;
  }

  const agentMainTaskId = dispatch.role === "ceo" ? env.MANUS_CEO_TASK_ID : env.MANUS_ANIMATOR_TASK_ID;
  if (!env.MANUS_API_KEY || !agentMainTaskId) {
    const missing = [
      !env.MANUS_API_KEY ? "MANUS_API_KEY" : "",
      !agentMainTaskId ? (dispatch.role === "ceo" ? "MANUS_CEO_TASK_ID" : "MANUS_ANIMATOR_TASK_ID") : "",
    ].filter(Boolean);
    const timestamp = nowIso();
    await env.DB.prepare(
      "UPDATE agent_dispatches SET status = 'awaiting_config', last_error = ?, updated_at = ? WHERE task_id = ? AND status IN ('pending', 'retry')",
    ).bind("Konfigurasi belum lengkap: " + missing.join(", "), timestamp, hubTaskId).run();
    await notifyPM(env,
      "Cue belum dapat dibangunkan untuk task " + hubTaskId + ". Konfigurasi Worker yang dibutuhkan: " +
      missing.join(", ") + ". Setelah disimpan dan Worker di-deploy, jalankan /wake " + hubTaskId + ".");
    return;
  }

  const attemptedAt = nowIso();
  const claim = await env.DB.prepare(
    "UPDATE agent_dispatches SET status = 'sending', attempts = attempts + 1, last_attempt_at = ?, updated_at = ? " +
      "WHERE task_id = ? AND status IN ('pending', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
  ).bind(attemptedAt, attemptedAt, hubTaskId, attemptedAt).run();
  if ((claim.meta?.changes ?? 0) !== 1) return;
  const attemptNumber = dispatch.attempts + 1;

  try {
    const result = await sendManusAgentMessage(
      env.MANUS_API_KEY,
      agentMainTaskId,
      hubTaskId,
      dispatch.role,
      dispatch.title,
    );
    const completedAt = nowIso();
    const saved = await env.DB.prepare(
      "UPDATE agent_dispatches SET status = 'dispatched', dispatched_at = ?, external_request_id = ?, " +
        "next_attempt_at = NULL, last_error = NULL, updated_at = ? WHERE task_id = ? AND status = 'sending'",
    ).bind(completedAt, result.requestId, completedAt, hubTaskId).run();
    if ((saved.meta?.changes ?? 0) === 1) {
      await notifyPM(env,
        "Wake-up Cue diterima Manus API. Role: " + dispatch.role + "\nHub task: " + hubTaskId +
        "\nStatus ini berarti pesan diterima; hasil pengerjaan tetap menunggu submit_result melalui MCP.");
    }
  } catch (error) {
    const status = error instanceof ManusApiError ? error.status : 0;
    const transient = !(error instanceof ManusApiError) || status === 429 || status >= 500;
    const retryAllowed = transient && attemptNumber < 5;
    const nextStatus = retryAllowed ? "retry" : "failed";
    const retryMinutes = Math.min(60, 15 * Math.pow(2, Math.max(0, attemptNumber - 1)));
    const retryAt = retryAllowed ? new Date(Date.now() + retryMinutes * 60_000).toISOString() : null;
    const detail = (error instanceof Error ? error.message : "Unknown Manus API error").slice(0, 300);
    const failedAt = nowIso();
    await env.DB.prepare(
      "UPDATE agent_dispatches SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE task_id = ? AND status = 'sending'",
    ).bind(nextStatus, detail, retryAt, failedAt, hubTaskId).run();
    await notifyPM(env,
      "Wake-up Cue gagal dikirim untuk task " + hubTaskId + " (HTTP " + (status || "network") + "). " +
      (retryAllowed ? "Akan dicoba ulang sekitar " + retryMinutes + " menit lagi." : "Perlu pemeriksaan konfigurasi/API.") +
      "\nDetail: " + detail);
  }
}

async function runAgentDispatchSweep(env: Env): Promise<void> {
  const timestamp = nowIso();
  const staleSendingCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  await env.DB.prepare(
    "UPDATE agent_dispatches SET status = 'retry', next_attempt_at = ?, last_error = 'Dispatch worker interrupted; retry scheduled.', updated_at = ? " +
      "WHERE status = 'sending' AND last_attempt_at <= ?",
  ).bind(timestamp, timestamp, staleSendingCutoff).run();

  // Backfill queued Cue work created before the outbox was introduced.
  await env.DB.prepare(
    "INSERT INTO agent_dispatches (id, task_id, role, provider, status, attempts, created_at, updated_at) " +
      "SELECT 'dsp_' || lower(hex(randomblob(6))), t.id, t.to_agent, 'manus', 'pending', 0, t.created_at, ? " +
      "FROM tasks t JOIN agents a ON a.role = t.to_agent AND a.active = 1 " +
      "WHERE a.vendor = 'cue' AND t.status = 'queued' " +
      "AND t.to_agent IN ('ceo', 'animator') " +
      "AND NOT EXISTS (SELECT 1 FROM agent_dispatches d WHERE d.task_id = t.id) " +
      "ON CONFLICT(task_id) DO NOTHING",
  ).bind(timestamp).run();

  const pending = await env.DB.prepare(
    "SELECT d.task_id FROM agent_dispatches d JOIN tasks t ON t.id = d.task_id " +
      "WHERE d.status IN ('pending', 'retry') AND t.status = 'queued' " +
      "AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?) ORDER BY d.created_at LIMIT 25",
  ).bind(timestamp).all<{ task_id: string }>();
  for (const item of pending.results ?? []) await dispatchCueTask(env, item.task_id);
}

async function decideApproval(env: Env, approvalId: string, decision: "approve" | "reject", note: string, actor: string): Promise<{ ok: boolean; error?: string; video_id?: string; stage?: string }> {
  const approval = await env.DB.prepare("SELECT * FROM approvals WHERE id = ? LIMIT 1").bind(approvalId).first<ApprovalRow>();
  if (!approval) return { ok: false, error: "Persetujuan tidak ditemukan." };
  if (approval.decision) return { ok: false, error: "Persetujuan ini sudah diputuskan." };
  const video = await env.DB.prepare("SELECT id, stage FROM videos WHERE id = ? LIMIT 1").bind(approval.video_id).first<VideoRow>();
  if (!video) return { ok: false, error: "Video untuk persetujuan tidak ditemukan." };
  const expectedVideoStage = approval.stage === "topic" ? "awaiting_topic_approval" : "awaiting_approval";
  if (video.stage !== expectedVideoStage) return { ok: false, error: "Tahap video tidak cocok dengan permintaan persetujuan." };
  const nextStage = approval.stage === "topic" ? (decision === "approve" ? "topic_approved" : "topic") : (decision === "approve" ? "approved" : "packaged");
  const timestamp = nowIso();
  const action = approval.stage + "_approval_" + (decision === "approve" ? "approved" : "rejected");
  const batch = await env.DB.batch([
    env.DB.prepare(
      "UPDATE approvals SET decision = ?, decided_at = ?, decided_by = ?, note = ? " +
        "WHERE id = ? AND decision IS NULL AND EXISTS (SELECT 1 FROM videos WHERE id = approvals.video_id AND stage = ?)",
    ).bind(decision, timestamp, actor, note || null, approvalId, expectedVideoStage),
    env.DB.prepare(
      "UPDATE videos SET stage = ?, updated_at = ? WHERE id = ? AND stage = ? " +
        "AND EXISTS (SELECT 1 FROM approvals WHERE id = ? AND decision = ? AND decided_at = ?)",
    ).bind(nextStage, timestamp, approval.video_id, expectedVideoStage, approvalId, decision, timestamp),
    env.DB.prepare(
      "INSERT INTO events (ts, actor, action, video_id, detail) " +
        "SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM approvals WHERE id = ? AND decision = ? AND decided_at = ?) " +
        "AND EXISTS (SELECT 1 FROM videos WHERE id = ? AND stage = ?)",
    ).bind(timestamp, actor, action, approval.video_id, JSON.stringify({ approval_id: approvalId, stage: approval.stage, decision, note }), approvalId, decision, timestamp, approval.video_id, nextStage),
  ]);
  if ((batch[0]?.meta?.changes ?? 0) !== 1 || (batch[1]?.meta?.changes ?? 0) !== 1) return { ok: false, error: "Status persetujuan berubah saat diproses. Muat ulang daftar persetujuan." };
  await notifyPM(env, "Persetujuan " + approvalId + " untuk video " + approval.video_id + ": " + decision.toUpperCase() + "\nTahap video sekarang: " + nextStage + (note ? "\nCatatan: " + note : ""));
  return { ok: true, video_id: approval.video_id, stage: nextStage };
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

function createServer(agent: AuthenticatedAgent, env: Env, origin: string, ctx: WorkerExecutionContext): McpServer {
  const db = env.DB;
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
            "SELECT * FROM events WHERE action IN ('result_ready', 'needs_reassign', 'topic_approval_approved', 'topic_approval_rejected', 'final_approval_approved', 'final_approval_rejected') ORDER BY ts DESC LIMIT ?",
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
      if (task.to_agent !== agent.role) {
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
              "WHERE id = ? AND status = 'queued' AND to_agent = ?",
          )
          .bind(claimedAt, claimedAt, task_id, agent.role),
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
      if (task.to_agent !== agent.role) {
        return toolError("Anda bukan penerima tugas '" + task_id + "'.");
      }
      if (task.status !== "claimed") {
        return toolError(
          "Tugas '" + task_id + "' berstatus '" + task.status + "', bukan 'claimed'.",
        );
      }

      let normalizedResult: Record<string, unknown> = result ?? {};
      let nextVideoStage: string | null = null;
      let expectedVideoStage: string | null = null;
      let gateReasons: string[] = [];
      if (status === "done" && task.type === "script") {
        expectedVideoStage = "topic_approved";
        const errors = validateScriptResult(normalizedResult);
        if (errors.length) return toolError("Skrip belum lengkap: " + errors.join(" "));
        nextVideoStage = "scripted";
      }
      if (status === "done" && task.type === "fact_check") {
        const scriptTask = await db.prepare("SELECT result FROM tasks WHERE video_id = ? AND type = 'script' AND status = 'done' ORDER BY created_at DESC LIMIT 1").bind(task.video_id).first<{ result: string | null }>();
        const evaluation = evaluateFactCheckGate(parseJson(scriptTask?.result, null), normalizedResult);
        gateReasons = evaluation.reasons;
        normalizedResult = { ...normalizedResult, gate_pass: evaluation.gatePass, gate_reasons: evaluation.reasons, verified_core_claims: evaluation.verifiedCoreClaims, total_core_claims: evaluation.totalCoreClaims };
        if (evaluation.gatePass) {
          expectedVideoStage = "scripted";
          nextVideoStage = "fact_checked";
        }
      }
      if (status === "done" && task.type === "render") {
        const artifactRows = await db.prepare("SELECT kind FROM artifacts WHERE task_id = ?").bind(task_id).all<{ kind: string }>();
        const kinds = new Set((artifactRows.results ?? []).map((row) => row.kind));
        const missing = ["video_mp4", "subtitle_srt", "cover_png"].filter((kind) => !kinds.has(kind));
        if (missing.length) return toolError("Render belum dapat ditandai selesai. Artefak wajib belum terdaftar: " + missing.join(", ") + ".");
        expectedVideoStage = "fact_checked";
        nextVideoStage = "animated";
      }
      if (status === "done" && task.type === "package") {
        const errors = validatePackageResult(normalizedResult);
        if (errors.length) return toolError("Paket social belum lengkap: " + errors.join(" "));
        expectedVideoStage = "animated";
        nextVideoStage = "packaged";
      }
      const updatedAt = nowIso();
      const notificationAction =
        task.type === "render" &&
        (status === "failed" ||
          (status === "blocked" && (blocked_reason === "limit" || blocked_reason === "failed")))
          ? "needs_reassign"
          : "result_ready";

      const taskUpdate = expectedVideoStage && task.video_id
        ? db.prepare(
            "UPDATE tasks SET status = ?, result = ?, blocked_reason = ?, updated_at = ? " +
              "WHERE id = ? AND status = 'claimed' AND to_agent = ? " +
              "AND EXISTS (SELECT 1 FROM videos WHERE id = ? AND stage = ?)",
          ).bind(status, JSON.stringify(normalizedResult), blocked_reason ?? null, updatedAt, task_id, agent.role, task.video_id, expectedVideoStage)
        : db.prepare(
            "UPDATE tasks SET status = ?, result = ?, blocked_reason = ?, updated_at = ? " +
              "WHERE id = ? AND status = 'claimed' AND to_agent = ?",
          ).bind(status, JSON.stringify(normalizedResult), blocked_reason ?? null, updatedAt, task_id, agent.role);
      const statements: D1PreparedStatement[] = [
        taskUpdate,
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
      ];
      if (nextVideoStage && task.video_id && expectedVideoStage) {
        statements.push(
          db.prepare("UPDATE videos SET stage = ?, updated_at = ? WHERE id = ? AND stage = ?")
            .bind(nextVideoStage, updatedAt, task.video_id, expectedVideoStage),
          db.prepare(
            "INSERT INTO events (ts, actor, action, video_id, detail) " +
              "SELECT ?, ?, 'video_stage_changed', ?, ? WHERE changes() = 1",
          ).bind(updatedAt, agent.name, task.video_id, JSON.stringify({ from_task: task_id, new_stage: nextVideoStage })),
        );
      }
      const batch = await db.batch(statements);

      if ((batch[0]?.meta?.changes ?? 0) !== 1) {
        return toolError("Tugas atau tahap video sudah berubah. Muat ulang sebelum mengirim hasil.");
      }
      if (nextVideoStage && (batch[3]?.meta?.changes ?? 0) !== 1) {
        return toolError("Tugas tercatat, tetapi tahap video tidak dapat diperbarui. Hub perlu diperiksa.");
      }
      if (task.type === "fact_check" && status === "done" && !nextVideoStage) await notifyPM(env, "Fact-check belum lolos untuk video " + task.video_id + ". " + gateReasons.join(" "));
      if (task.type === "chat_message" || task.type === "group_discussion") {
        const chatPayload = parseJson<Record<string, unknown>>(task.payload, {});
        const threadId = typeof chatPayload.thread_id === "string" ? chatPayload.thread_id : "";
        if (chatPayload.channel === "telegram" && threadId) {
          const reply = formatTelegramAgentReply(agent.role, status, normalizedResult, task_id, blocked_reason);
          const replyAt = nowIso();
          await env.DB.batch([
            env.DB.prepare("INSERT INTO chat_messages (id, thread_id, task_id, direction, actor, role, message_text, created_at) VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?)")
              .bind(newId("msg_"), threadId, task_id, agent.name, agent.role, reply, replyAt),
            env.DB.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").bind(replyAt, threadId),
          ]);
          await notifyPM(env, reply);
        }
      }
      return textResult({
        task_id, status, notification: notificationAction, video_stage: nextVideoStage,
        gate_pass: task.type === "fact_check" && status === "done" ? normalizedResult.gate_pass : undefined,
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
        priority: z.string().min(1).max(32).default("normal"),
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

      const pipelineTypes = new Set(["script", "fact_check", "render", "package"]);
      if (pipelineTypes.has(type) && !video_id) return toolError("Tipe tugas '" + type + "' wajib menyertakan video_id.");
      if (video_id) {
        const video = await db.prepare("SELECT id, stage FROM videos WHERE id = ? LIMIT 1").bind(video_id).first<{ id: string; stage: string }>();
        if (!video) return toolError("Video '" + video_id + "' tidak ditemukan.");
        const requiredStage: Record<string, string> = { script: "topic_approved", fact_check: "scripted", render: "fact_checked", package: "animated" };
        if (requiredStage[type] && video.stage !== requiredStage[type]) return toolError("Tugas '" + type + "' belum boleh dibuat. Video harus berada pada tahap '" + requiredStage[type] + "', saat ini '" + video.stage + "'.");
      }
      if (reassigned_from) {
        const oldTask = await db.prepare("SELECT id, type, to_agent, video_id, status FROM tasks WHERE id = ? LIMIT 1").bind(reassigned_from)
          .first<{ id: string; type: string; to_agent: string; video_id: string | null; status: string }>();
        if (!oldTask || !["blocked", "failed", "stale"].includes(oldTask.status)) return toolError("reassigned_from harus menunjuk tugas blocked, failed, atau stale.");
        if (oldTask.type !== type || oldTask.video_id !== (video_id ?? null)) return toolError("Tugas pengganti harus memakai tipe tugas dan video_id yang sama.");
        if (type !== "render" || oldTask.to_agent !== "animator" || to !== "animator_backup") return toolError("Failover hanya diizinkan dari animator ke animator_backup untuk tugas render.");
      }
      const targetAgent = await db.prepare("SELECT vendor FROM agents WHERE role = ? AND active = 1 LIMIT 1")
        .bind(to).first<{ vendor: string }>();
      const createdAt = nowIso();
      const taskId = newId("tsk_");
      const statements: D1PreparedStatement[] = [];

      if (reassigned_from) {
        const oldTask = await db
          .prepare("SELECT id, status FROM tasks WHERE id = ? LIMIT 1")
          .bind(reassigned_from)
          .first<{ id: string; status: string }>();

        if (oldTask && ["blocked", "failed", "stale"].includes(oldTask.status)) {
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
                JSON.stringify({
                  previous_status: oldTask.status,
                  new_status: "superseded",
                  reassigned_to_role: to,
                }),
                reassigned_from,
                createdAt,
              ),
          );
        }
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
      if (targetAgent?.vendor === "cue" && (to === "ceo" || to === "animator")) {
        statements.push(
          db.prepare(
            "INSERT INTO agent_dispatches (id, task_id, role, provider, status, attempts, created_at, updated_at) " +
              "VALUES (?, ?, ?, 'manus', 'pending', 0, ?, ?) ON CONFLICT(task_id) DO NOTHING",
          ).bind(newId("dsp_"), taskId, to, createdAt, createdAt),
        );
      }
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
      if (targetAgent?.vendor === "cue" && (to === "ceo" || to === "animator")) {
        ctx.waitUntil(dispatchCueTask(env, taskId));
      }
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

  server.registerTool("get_task_result", {
    description: "Mengambil status, payload, dan hasil JSON sebuah task. Hanya CEO yang dapat membaca hasil lintas agen.",
    inputSchema: { task_id: z.string().min(1).max(64) },
  }, async ({ task_id }) => {
    validateToolAccess(agent.role, "get_task_result");
    const task = await db.prepare(
      "SELECT id, video_id, type, title, payload, from_agent, to_agent, status, blocked_reason, result, attempt, created_at, updated_at " +
        "FROM tasks WHERE id = ? LIMIT 1",
    ).bind(task_id).first<TaskRow>();
    if (!task) return toolError("Tugas dengan ID '" + task_id + "' tidak ditemukan.");
    return textResult({
      task_id: task.id,
      video_id: task.video_id,
      type: task.type,
      title: task.title,
      from: task.from_agent,
      to: task.to_agent,
      status: task.status,
      blocked_reason: task.blocked_reason,
      attempt: task.attempt,
      created_at: task.created_at,
      updated_at: task.updated_at,
      payload: parseJson(task.payload, {}),
      result: parseJson(task.result, null),
    });
  });

  server.registerTool("create_video", {
    description: "Membuat entri produksi video baru setelah CEO memilih topik.",
    inputSchema: { topic: z.string().min(5).max(255), pillar: z.string().max(80).optional() },
  }, async ({ topic, pillar }) => {
    validateToolAccess(agent.role, "create_video");
    const id = newId("vid_"); const timestamp = nowIso();
    await db.batch([
      db.prepare("INSERT INTO videos (id, topic, pillar, stage, created_at, updated_at) VALUES (?, ?, ?, 'topic', ?, ?)").bind(id, topic.trim(), pillar ?? null, timestamp, timestamp),
      db.prepare("INSERT INTO events (ts, actor, action, video_id, detail) VALUES (?, ?, 'video_created', ?, ?)").bind(timestamp, agent.name, id, JSON.stringify({ topic, pillar: pillar ?? null })),
    ]);
    return textResult({ video_id: id, stage: "topic", message: "Video dibuat. Ajukan persetujuan topik PM sebelum tugas script." });
  });
  server.registerTool("request_upload", {
    description: "Membuat sesi unggah artefak sementara ke R2 untuk tugas yang sedang diklaim.",
    inputSchema: {
      task_id: z.string().min(1).max(64),
      kind: z.enum(["video_mp4", "subtitle_srt", "cover_png", "storyboard", "source_report", "caption_pack"]),
      file_name: z.string().min(1).max(180), content_type: z.string().min(1).max(100),
      size_bytes: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    },
  }, async ({ task_id, kind, file_name, content_type, size_bytes, sha256: expectedSha256 }) => {
    validateToolAccess(agent.role, "request_upload");
    if (!ALLOWED_ARTIFACT_KINDS.has(kind)) return toolError("Jenis artefak tidak diizinkan.");
    if (!ALLOWED_CONTENT_TYPES.has(content_type.toLowerCase())) return toolError("Content-Type artefak tidak diizinkan.");
    const task = await db.prepare("SELECT id, video_id, to_agent, status, type FROM tasks WHERE id = ? LIMIT 1").bind(task_id)
      .first<{ id: string; video_id: string | null; to_agent: string; status: string; type: string }>();
    if (!task || !task.video_id) return toolError("Tugas tidak ditemukan atau tidak terkait video.");
    if (task.to_agent !== agent.role || task.status !== "claimed") return toolError("Unggah hanya dapat diminta oleh penerima tugas berstatus claimed.");
    const expectedTaskType = ["video_mp4", "subtitle_srt", "cover_png", "storyboard"].includes(kind) ? "render" : kind === "caption_pack" ? "package" : "fact_check";
    if (task.type !== expectedTaskType) return toolError("Jenis artefak tidak sesuai dengan tipe tugas.");
    const uploadId = newId("upl_"); const token = randomBase64Url(32);
    const createdAt = nowIso(); const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
    const objectKey = "videos/" + task.video_id + "/" + task.id + "/" + uploadId + "/" + safeFileName(file_name);
    await db.prepare("INSERT INTO upload_sessions (id, task_id, video_id, agent_id, kind, file_name, content_type, expected_size, expected_sha256, object_key, token_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)")
      .bind(uploadId, task.id, task.video_id, agent.id, kind, safeFileName(file_name), content_type.toLowerCase(), size_bytes, expectedSha256.toLowerCase(), objectKey, await sha256(token), createdAt, expiresAt).run();
    return textResult({
      upload_id: uploadId, upload_url: origin + "/artifacts/upload/" + uploadId, method: "PUT",
      headers: { "X-Upload-Token": token, "Content-Type": content_type.toLowerCase() },
      expected_size_bytes: size_bytes, expected_sha256: expectedSha256.toLowerCase(),
      maximum_size_bytes: MAX_ARTIFACT_BYTES, expires_at: expiresAt,
      message: "Unggah satu kali ke URL ini. R2 akan memverifikasi SHA-256 saat menyimpan; setelah sukses panggil post_artifact.",
    });
  });
  server.registerTool("post_artifact", {
    description: "Mendaftarkan unggahan R2 sebagai artefak resmi pada tugas dan video.",
    inputSchema: { task_id: z.string().min(1).max(64), upload_id: z.string().min(1).max(64), sha256: z.string().regex(/^[a-f0-9]{64}$/i) },
  }, async ({ task_id, upload_id, sha256: suppliedHash }) => {
    validateToolAccess(agent.role, "post_artifact");
    const session = await db.prepare("SELECT * FROM upload_sessions WHERE id = ? LIMIT 1").bind(upload_id).first<UploadSessionRow>();
    if (!session || session.task_id !== task_id || session.agent_id !== agent.id) return toolError("Sesi unggah bukan milik agen atau tugas ini.");
    if (session.status !== "uploaded" || !session.sha256 || !session.size_bytes) return toolError("Berkas belum diunggah atau sudah didaftarkan.");
    if (!constantTimeEqual(session.sha256, suppliedHash.toLowerCase())) return toolError("Checksum tidak cocok dengan hasil streaming server.");
    const task = await db.prepare("SELECT video_id, to_agent, status FROM tasks WHERE id = ? LIMIT 1").bind(task_id).first<{ video_id: string | null; to_agent: string; status: string }>();
    if (!task || task.to_agent !== agent.role || task.status !== "claimed" || task.video_id !== session.video_id) return toolError("Tugas bukan lagi milik agen ini atau status bukan claimed.");
    const artifactId = newId("art_"); const timestamp = nowIso();
    const batch = await db.batch([
      db.prepare("UPDATE upload_sessions SET status = 'registered' WHERE id = ? AND status = 'uploaded'").bind(upload_id),
      db.prepare("INSERT INTO artifacts (id, upload_id, task_id, video_id, kind, name, uri, sha256, size_bytes, created_by, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
        .bind(artifactId, upload_id, task_id, session.video_id, session.kind, session.file_name, "r2://" + session.object_key, session.sha256, session.size_bytes, agent.name, timestamp),
      db.prepare("INSERT INTO events (ts, actor, action, task_id, video_id, detail) SELECT ?, ?, 'artifact_registered', ?, ?, ? WHERE changes() = 1")
        .bind(timestamp, agent.name, task_id, session.video_id, JSON.stringify({ artifact_id: artifactId, kind: session.kind, sha256: session.sha256, size_bytes: session.size_bytes })),
    ]);
    if ((batch[0]?.meta?.changes ?? 0) !== 1 || (batch[1]?.meta?.changes ?? 0) !== 1) return toolError("Sesi unggah sudah didaftarkan atau berubah status.");
    return textResult({ artifact_id: artifactId, task_id, video_id: session.video_id, kind: session.kind, sha256: session.sha256, size_bytes: session.size_bytes });
  });
  server.registerTool("get_artifact", {
    description: "Memberikan URL unduh artefak jika role pemanggil terlibat pada alur video.",
    inputSchema: { artifact_id: z.string().min(1).max(64) },
  }, async ({ artifact_id }) => {
    validateToolAccess(agent.role, "get_artifact");
    const artifact = await db.prepare("SELECT id, video_id, name, kind, uri, sha256, size_bytes FROM artifacts WHERE id = ? LIMIT 1").bind(artifact_id)
      .first<{ id: string; video_id: string; name: string; kind: string; uri: string; sha256: string; size_bytes: number }>();
    if (!artifact) return toolError("Artefak tidak ditemukan.");
    const access = await db.prepare("SELECT 1 AS allowed FROM tasks WHERE video_id = ? AND (to_agent = ? OR from_agent = ?) LIMIT 1")
      .bind(artifact.video_id, agent.role, agent.role).first<{ allowed: number }>();
    if (agent.role !== "ceo" && !access) return toolError("Role ini tidak memiliki akses ke artefak video.");
    const tokenId = newId("dlt_");
    const downloadToken = randomBase64Url(32);
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
    await db.prepare("INSERT INTO artifact_access_tokens (id, artifact_id, agent_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(tokenId, artifact_id, agent.id, await sha256(downloadToken), expiresAt).run();
    return textResult({
      artifact_id, name: artifact.name, kind: artifact.kind, sha256: artifact.sha256, size_bytes: artifact.size_bytes,
      download_url: origin + "/artifacts/" + artifact_id + "/download",
      headers: { "X-Download-Token": downloadToken }, expires_at: expiresAt,
    });
  });
  server.registerTool("request_approval", {
    description: "Mengajukan persetujuan topik atau video final kepada PM manusia.",
    inputSchema: { video_id: z.string().min(1).max(64), stage: z.enum(["topic", "final"]), summary: z.string().min(10).max(2000) },
  }, async ({ video_id, stage, summary }) => {
    validateToolAccess(agent.role, "request_approval");
    const video = await db.prepare("SELECT id, topic, stage FROM videos WHERE id = ? LIMIT 1").bind(video_id).first<VideoRow>();
    if (!video) return toolError("Video tidak ditemukan.");
    const requiredStage = stage === "topic" ? "topic" : "packaged";
    if (video.stage !== requiredStage) return toolError("Persetujuan '" + stage + "' hanya dapat diajukan pada tahap '" + requiredStage + "'. Saat ini: '" + video.stage + "'.");
    if (stage === "final") {
      const artifactRows = await db.prepare("SELECT kind FROM artifacts WHERE video_id = ?").bind(video_id).all<{ kind: string }>();
      const kinds = new Set((artifactRows.results ?? []).map((item) => item.kind));
      const missing = ["video_mp4", "subtitle_srt", "cover_png"].filter((kind) => !kinds.has(kind));
      if (missing.length) return toolError("Artefak belum lengkap: " + missing.join(", ") + ".");
      const packageTask = await db.prepare("SELECT result FROM tasks WHERE video_id = ? AND type = 'package' AND status = 'done' ORDER BY created_at DESC LIMIT 1").bind(video_id).first<{ result: string | null }>();
      const errors = validatePackageResult(parseJson(packageTask?.result, null));
      if (errors.length) return toolError("Paket social belum lengkap: " + errors.join(" "));
    }
    const pending = await db.prepare("SELECT id FROM approvals WHERE video_id = ? AND stage = ? AND decision IS NULL LIMIT 1").bind(video_id, stage).first<{ id: string }>();
    if (pending) return toolError("Masih ada permintaan persetujuan yang menunggu untuk tahap ini.");
    const approvalId = newId("apv_"); const timestamp = nowIso();
    const nextStage = stage === "topic" ? "awaiting_topic_approval" : "awaiting_approval";
    const approvalBatch = await db.batch([
      db.prepare(
        "UPDATE videos SET stage = ?, updated_at = ? WHERE id = ? AND stage = ? " +
          "AND NOT EXISTS (SELECT 1 FROM approvals WHERE video_id = ? AND stage = ? AND decision IS NULL)",
      ).bind(nextStage, timestamp, video_id, video.stage, video_id, stage),
      db.prepare(
        "INSERT INTO approvals (id, video_id, stage, requested_at, summary, requested_by) " +
          "SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1",
      ).bind(approvalId, video_id, stage, timestamp, summary, agent.name),
      db.prepare(
        "INSERT INTO events (ts, actor, action, video_id, detail) " +
          "SELECT ?, ?, 'approval_requested', ?, ? WHERE changes() = 1",
      ).bind(timestamp, agent.name, video_id, JSON.stringify({ approval_id: approvalId, stage, summary })),
    ]);
    if ((approvalBatch[0]?.meta?.changes ?? 0) !== 1 || (approvalBatch[1]?.meta?.changes ?? 0) !== 1) {
      return toolError("Permintaan persetujuan berubah atau sudah dibuat oleh eksekusi lain. Muat ulang status video.");
    }
    const keyboard = { inline_keyboard: [[{ text: "Setujui", callback_data: "approve:" + approvalId }, { text: "Tolak", callback_data: "reject:" + approvalId }]] };
    await notifyPM(env, "Permintaan persetujuan " + stage + " untuk video " + video_id + "\n" + video.topic + "\n\n" + summary, keyboard);
    return textResult({ approval_id: approvalId, video_id, stage, status: "pending", next_video_stage: nextStage, message: "Menunggu keputusan PM melalui /pm/approvals atau Telegram jika webhook dikonfigurasi." });
  });

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

async function artifactUploadRoute(request: Request, env: Env, uploadId: string): Promise<Response> {
  const token = request.headers.get("x-upload-token") ?? "";
  if (!token) return jsonResponse({ error: "X-Upload-Token wajib diisi." }, 401);
  const session = await env.DB.prepare("SELECT * FROM upload_sessions WHERE id = ? LIMIT 1").bind(uploadId).first<UploadSessionRow>();
  if (!session || session.status !== "issued") return jsonResponse({ error: "Sesi unggah tidak ditemukan atau sudah dipakai." }, 404);
  if (!constantTimeEqual(session.token_hash, await sha256(token))) return jsonResponse({ error: "Token unggah tidak valid." }, 401);
  const task = await env.DB.prepare("SELECT to_agent, status FROM tasks WHERE id = ? LIMIT 1").bind(session.task_id)
    .first<{ to_agent: string; status: string }>();
  const agent = await env.DB.prepare("SELECT name, role, active FROM agents WHERE id = ? LIMIT 1").bind(session.agent_id)
    .first<{ name: string; role: string; active: number }>();
  if (!task || !agent || agent.active !== 1 || task.to_agent !== agent.role || task.status !== "claimed") {
    return jsonResponse({ error: "Agen atau tugas tidak lagi berhak melakukan unggah ini." }, 403);
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    await env.DB.prepare("UPDATE upload_sessions SET status = 'failed' WHERE id = ?").bind(uploadId).run();
    return jsonResponse({ error: "Sesi unggah kedaluwarsa. Minta sesi baru." }, 410);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!request.body || !Number.isFinite(contentLength) || contentLength !== session.expected_size || contentLength > MAX_ARTIFACT_BYTES) return jsonResponse({ error: "Content-Length harus sama dengan size_bytes dan maksimal 90 MiB." }, 413);
  if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== session.content_type) return jsonResponse({ error: "Content-Type tidak sama dengan sesi unggah." }, 415);
  const claim = await env.DB.prepare("UPDATE upload_sessions SET status = 'uploading' WHERE id = ? AND status = 'issued'").bind(uploadId).run();
  if ((claim.meta?.changes ?? 0) !== 1) return jsonResponse({ error: "Sesi unggah sedang digunakan." }, 409);
  try {
    // Pass the known-length Request body directly. TransformStream removes the
    // length metadata R2 requires for a streaming PUT.
    const stored = await env.ARTIFACTS.put(session.object_key, request.body, {
      httpMetadata: { contentType: session.content_type },
      customMetadata: { uploadId, videoId: session.video_id, taskId: session.task_id },
      sha256: hexToBytes(session.expected_sha256),
    });
    if (!stored || stored.size !== session.expected_size || !stored.checksums?.sha256) {
      await env.ARTIFACTS.delete(session.object_key);
      await env.DB.prepare("UPDATE upload_sessions SET status = 'failed' WHERE id = ?").bind(uploadId).run();
      return jsonResponse({ error: "Unggah atau verifikasi ukuran/checksum SHA-256 gagal." }, 400);
    }
    const digest = bytesToHex(stored.checksums.sha256);
    if (!constantTimeEqual(digest, session.expected_sha256)) {
      await env.ARTIFACTS.delete(session.object_key);
      await env.DB.prepare("UPDATE upload_sessions SET status = 'failed' WHERE id = ?").bind(uploadId).run();
      return jsonResponse({ error: "SHA-256 objek R2 tidak cocok dengan checksum yang dijanjikan." }, 400);
    }
    const sizeBytes = stored.size;
    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE upload_sessions SET status = 'uploaded', sha256 = ?, size_bytes = ?, uploaded_at = ? WHERE id = ? AND status = 'uploading'").bind(digest, sizeBytes, timestamp, uploadId),
      env.DB.prepare("INSERT INTO events (ts, actor, action, task_id, video_id, detail) VALUES (?, ?, 'artifact_uploaded', ?, ?, ?)").bind(timestamp, agent.name, session.task_id, session.video_id, JSON.stringify({ upload_id: uploadId, kind: session.kind, size_bytes: sizeBytes, sha256: digest })),
    ]);
    return jsonResponse({ ok: true, upload_id: uploadId, sha256: digest, size_bytes: sizeBytes });
  } catch (error) {
    await env.ARTIFACTS.delete(session.object_key).catch(() => undefined);
    await env.DB.prepare("UPDATE upload_sessions SET status = 'failed' WHERE id = ?").bind(uploadId).run();
    console.error(JSON.stringify({ event: "artifact_upload_failed", upload_id: uploadId, reason: error instanceof Error ? error.message : "unknown" }));
    return jsonResponse({ error: "Unggah artefak gagal. Minta sesi unggah baru." }, 500);
  }
}
async function artifactDownloadRoute(request: Request, env: Env, artifactId: string, pm = false): Promise<Response> {
  if (pm) {
    if (!pmAuthorized(request, env)) return jsonResponse({ error: "PM authorization required." }, env.PM_TOKEN ? 401 : 503);
  } else {
    const token = request.headers.get("x-download-token") ?? "";
    if (!token) return jsonResponse({ error: "X-Download-Token wajib diisi." }, 401);
    const tokenRow = await env.DB.prepare("SELECT * FROM artifact_access_tokens WHERE artifact_id = ? AND token_hash = ? AND used_at IS NULL LIMIT 1")
      .bind(artifactId, await sha256(token)).first<ArtifactAccessTokenRow>();
    if (!tokenRow || Date.parse(tokenRow.expires_at) <= Date.now()) return jsonResponse({ error: "Token unduh tidak ditemukan, sudah dipakai, atau kedaluwarsa." }, 410);
    const agent = await env.DB.prepare("SELECT id, role, active FROM agents WHERE id = ? LIMIT 1").bind(tokenRow.agent_id)
      .first<{ id: string; role: string; active: number }>();
    const artifactCheck = await env.DB.prepare("SELECT video_id FROM artifacts WHERE id = ? LIMIT 1").bind(artifactId).first<{ video_id: string }>();
    if (!agent || agent.active !== 1 || !artifactCheck) return jsonResponse({ error: "Agen atau artefak tidak aktif." }, 403);
    const allowed = await env.DB.prepare("SELECT 1 AS allowed FROM tasks WHERE video_id = ? AND (to_agent = ? OR from_agent = ?) LIMIT 1")
      .bind(artifactCheck.video_id, agent.role, agent.role).first<{ allowed: number }>();
    if (agent.role !== "ceo" && !allowed) return jsonResponse({ error: "Role tidak memiliki akses ke artefak ini." }, 403);
    const used = await env.DB.prepare("UPDATE artifact_access_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL")
      .bind(nowIso(), tokenRow.id).run();
    if ((used.meta?.changes ?? 0) !== 1) return jsonResponse({ error: "Token unduh sudah dipakai." }, 409);
  }
  const artifact = await env.DB.prepare("SELECT id, name, uri, sha256 FROM artifacts WHERE id = ? LIMIT 1").bind(artifactId).first<{ id: string; name: string; uri: string; sha256: string }>();
  if (!artifact) return jsonResponse({ error: "Artefak tidak ditemukan." }, 404);
  const objectKey = artifact.uri.startsWith("r2://") ? artifact.uri.slice(5) : "";
  if (!objectKey) return jsonResponse({ error: "Referensi artefak tidak valid." }, 500);
  const object = await env.ARTIFACTS.get(objectKey);
  if (!object) return jsonResponse({ error: "Objek artefak tidak ditemukan di R2." }, 404);
  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("content-length", String(object.size));
  headers.set("content-disposition", "attachment; filename=\"" + safeFileName(artifact.name) + "\"");
  headers.set("cache-control", "private, no-store");
  headers.set("x-artifact-sha256", artifact.sha256);
  return new Response(object.body, { status: 200, headers });
}
async function pmRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (!pmAuthorized(request, env)) return jsonResponse({ error: "PM authorization required. Configure PM_TOKEN as a Worker secret." }, env.PM_TOKEN ? 401 : 503);
  if (request.method === "GET" && url.pathname === "/pm/approvals") {
    const rows = await env.DB.prepare("SELECT a.id, a.video_id, a.stage, a.requested_at, a.summary, a.requested_by, v.topic, v.stage AS video_stage FROM approvals a JOIN videos v ON v.id = a.video_id WHERE a.decision IS NULL ORDER BY a.requested_at").all<Record<string, unknown>>();
    return jsonResponse({ approvals: rows.results ?? [] });
  }
  if (request.method === "POST") {
    const match = url.pathname.match(/^\/pm\/approvals\/([^/]+)\/decision$/);
    if (match) {
      let body: { decision?: string; note?: string };
      try { body = await request.json() as { decision?: string; note?: string }; } catch { return jsonResponse({ error: "Body harus JSON valid." }, 400); }
      if (body.decision !== "approve" && body.decision !== "reject") return jsonResponse({ error: "decision harus approve atau reject." }, 400);
      if (typeof body.note === "string" && body.note.length > 1000) return jsonResponse({ error: "note maksimal 1000 karakter." }, 400);
      const result = await decideApproval(env, decodeURIComponent(match[1]), body.decision, body.note ?? "", "pm");
      return result.ok ? jsonResponse(result) : jsonResponse({ error: result.error }, 409);
    }
    const publishedMatch = url.pathname.match(/^\/pm\/videos\/([^/]+)\/published$/);
    if (publishedMatch) {
      let body: { tiktok_url?: string };
      try { body = await request.json() as { tiktok_url?: string }; } catch { return jsonResponse({ error: "Body harus JSON valid." }, 400); }
      if (typeof body.tiktok_url !== "string" || !/^https:\/\/(?:(?:www|vt|vm)\.)?tiktok\.com\//i.test(body.tiktok_url)) return jsonResponse({ error: "tiktok_url harus berupa URL TikTok yang valid." }, 400);
      const videoId = decodeURIComponent(publishedMatch[1]); const timestamp = nowIso();
      const update = await env.DB.prepare("UPDATE videos SET stage = 'published', published_at = ?, tiktok_url = ?, updated_at = ? WHERE id = ? AND stage = 'approved'").bind(timestamp, body.tiktok_url, timestamp, videoId).run();
      if ((update.meta?.changes ?? 0) !== 1) return jsonResponse({ error: "Video tidak ditemukan atau belum disetujui PM." }, 409);
      await env.DB.prepare("INSERT INTO events (ts, actor, action, video_id, detail) VALUES (?, 'pm', 'video_published', ?, ?)").bind(timestamp, videoId, JSON.stringify({ tiktok_url: body.tiktok_url })).run();
      return jsonResponse({ ok: true, video_id: videoId, stage: "published" });
    }
    const metricsMatch = url.pathname.match(/^\/pm\/videos\/([^/]+)\/metrics$/);
    if (metricsMatch) {
      let body: Record<string, unknown>;
      try { body = await request.json() as Record<string, unknown>; } catch { return jsonResponse({ error: "Body harus JSON valid." }, 400); }
      if (!["24h", "72h", "7d"].includes(String(body.window))) return jsonResponse({ error: "window harus 24h, 72h, atau 7d." }, 400);
      for (const field of ["views", "likes", "comments", "shares", "saves", "follows"]) if (!Number.isInteger(body[field]) || Number(body[field]) < 0) return jsonResponse({ error: field + " harus integer non-negatif." }, 400);
      if (typeof body.avg_watch_pct !== "number" || body.avg_watch_pct < 0 || body.avg_watch_pct > 100) return jsonResponse({ error: "avg_watch_pct harus 0 sampai 100." }, 400);
      const videoId = decodeURIComponent(metricsMatch[1]); const timestamp = nowIso();
      const video = await env.DB.prepare("SELECT id, stage FROM videos WHERE id = ?").bind(videoId).first<{ id: string; stage: string }>();
      if (!video || video.stage !== "published") return jsonResponse({ error: "Metrik hanya dapat dicatat untuk video published." }, 409);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO metrics (video_id, captured_at, window, views, avg_watch_pct, likes, comments, shares, saves, follows) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(videoId, timestamp, body.window, body.views, body.avg_watch_pct, body.likes, body.comments, body.shares, body.saves, body.follows),
        env.DB.prepare("INSERT INTO events (ts, actor, action, video_id, detail) VALUES (?, 'pm', 'metrics_recorded', ?, ?)").bind(timestamp, videoId, JSON.stringify({ window: body.window })),
      ]);
      return jsonResponse({ ok: true, video_id: videoId, window: body.window });
    }
  }
  const videoMatch = url.pathname.match(/^\/pm\/videos\/([^/]+)$/);
  if (request.method === "GET" && videoMatch) {
    const videoId = decodeURIComponent(videoMatch[1]);
    const video = await env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(videoId).first<VideoRow>();
    if (!video) return jsonResponse({ error: "Video tidak ditemukan." }, 404);
    const [artifacts, events, metrics] = await Promise.all([
      env.DB.prepare("SELECT id, task_id, kind, name, sha256, size_bytes, created_at FROM artifacts WHERE video_id = ? ORDER BY created_at").bind(videoId).all(),
      env.DB.prepare("SELECT ts, actor, action, task_id, detail FROM events WHERE video_id = ? ORDER BY ts").bind(videoId).all(),
      env.DB.prepare("SELECT captured_at, window, views, avg_watch_pct, likes, comments, shares, saves, follows FROM metrics WHERE video_id = ? ORDER BY captured_at").bind(videoId).all(),
    ]);
    return jsonResponse({ video, artifacts: artifacts.results ?? [], events: events.results ?? [], metrics: metrics.results ?? [] });
  }
  const artifactMatch = url.pathname.match(/^\/pm\/artifacts\/([^/]+)\/download$/);
  if (request.method === "GET" && artifactMatch) return artifactDownloadRoute(request, env, decodeURIComponent(artifactMatch[1]), true);
  return jsonResponse({ error: "PM route tidak ditemukan." }, 404);
}
const TELEGRAM_AGENT_ROLES = ["ceo", "animator", "animator_backup"] as const;
type TelegramAgentRole = (typeof TELEGRAM_AGENT_ROLES)[number];

async function telegramThreadId(chatId: string): Promise<string> {
  return "thr_tg_" + (await sha256(chatId)).slice(0, 20);
}

async function createTelegramChatTask(
  env: Env, role: TelegramAgentRole, type: "chat_message" | "group_discussion",
  prompt: string, chatId: string, messageId: string, username: string,
): Promise<{ taskId: string; vendor: string }> {
  const active = await env.DB.prepare("SELECT id, vendor FROM agents WHERE role = ? AND active = 1 ORDER BY CASE WHEN vendor = 'muse' THEN 0 ELSE 1 END, created_at LIMIT 1")
    .bind(role).first<{ id: string; vendor: string }>();
  if (!active) throw new Error("Akun agen untuk role '" + role + "' belum aktif di Hub.");
  const threadId = await telegramThreadId(chatId);
  const existingMessage = await env.DB.prepare(
    "SELECT task_id FROM chat_messages WHERE external_chat_id = ? AND external_message_id = ? AND direction = 'inbound' LIMIT 1",
  ).bind(chatId, messageId).first<{ task_id: string | null }>();
  if (existingMessage?.task_id) return { taskId: existingMessage.task_id, vendor: active.vendor };
  const historyRows = await env.DB.prepare(
    "SELECT actor, role, direction, message_text, created_at FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 8",
  ).bind(threadId).all<Record<string, unknown>>();
  const history = (historyRows.results ?? []).reverse().map((row) => ({
    actor: row.actor, role: row.role, direction: row.direction,
    text: String(row.message_text ?? "").slice(0, 1200), created_at: row.created_at,
  }));
  const taskId = newId("tsk_");
  const createdAt = nowIso();
  const payload = {
    channel: "telegram", thread_id: threadId, chat_id: chatId,
    telegram_message_id: messageId, requested_by: username || "PM", prompt,
    conversation_history: history,
    instructions: type === "group_discussion"
      ? "Bertindak sebagai Muse Controller tunggal. Kerjakan riset, strategi, fact-check, dan QA secara langsung. Gunakan send_task hanya bila Animator Primary atau Backup memang diperlukan untuk produksi visual. Baca hasil tugas anak melalui get_task_result, lalu submit_result pada task diskusi asli dengan result.answer dan result.consulted. Jangan membuat diskusi rekursif."
      : "Jawab pertanyaan PM secara langsung dan ringkas. Kirim hasil melalui submit_result dengan result.answer. Jangan mengubah state pipeline atau melakukan publikasi.",
  };
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO chat_threads (id, channel, external_chat_id, created_by, created_at, updated_at) VALUES (?, 'telegram', ?, 'pm-telegram', ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
    ).bind(threadId, chatId, createdAt, createdAt),
    env.DB.prepare(
      "INSERT INTO tasks (id, type, title, payload, priority, from_agent, to_agent, status, attempt, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, 'normal', 'pm-telegram', ?, 'queued', 1, ?, ?)",
    ).bind(taskId, type, "Telegram " + (type === "group_discussion" ? "discussion" : "chat") + ": " + prompt.slice(0, 160), JSON.stringify(payload), role, createdAt, createdAt),
  ];
  statements.push(
    env.DB.prepare(
      "INSERT INTO events (ts, actor, action, task_id, detail) VALUES (?, 'pm-telegram', 'telegram_chat_task_created', ?, ?)",
    ).bind(createdAt, taskId, JSON.stringify({ role, type, thread_id: threadId, message_id: messageId })),
    env.DB.prepare(
      "INSERT INTO chat_messages (id, thread_id, task_id, direction, actor, role, message_text, external_chat_id, external_message_id, created_at) " +
      "VALUES (?, ?, ?, 'inbound', 'pm-telegram', 'pm', ?, ?, ?, ?)",
    ).bind(newId("msg_"), threadId, taskId, prompt, chatId, messageId, createdAt),
  );
  await env.DB.batch(statements);
  return { taskId, vendor: active.vendor };
}

async function handleTelegramMessage(env: Env, message: Record<string, unknown>, ctx: WorkerExecutionContext): Promise<Response> {
  const from = message.from as Record<string, unknown> | undefined;
  const chat = message.chat as Record<string, unknown> | undefined;
  const chatId = String(chat?.id ?? "");
  const chatType = String(chat?.type ?? "");
  if (!chatId || from?.is_bot === true || String(from?.id ?? "") !== String(env.TELEGRAM_PM_USER_ID ?? "")) return jsonResponse({ ok: true });
  if (chatType !== "group" && chatType !== "supergroup") return jsonResponse({ ok: true });
  const parsed = typeof message.text === "string" ? parseTelegramCommand(message.text) : null;
  if (!parsed) return jsonResponse({ ok: true });
  const send = (text: string) => sendTelegramMessage(env, chatId, text);

  if (parsed.name === "bind") {
    const configured = await telegramGroupChatId(env);
    if (env.TELEGRAM_GROUP_CHAT_ID && env.TELEGRAM_GROUP_CHAT_ID !== chatId) {
      await send("Grup ini tidak cocok dengan TELEGRAM_GROUP_CHAT_ID yang dikonfigurasi.");
      return jsonResponse({ ok: true });
    }
    if (configured && configured !== chatId) {
      await send("Gateway sudah terikat ke grup lain. Jangan memindahkan binding tanpa mengganti konfigurasi secara sengaja.");
      return jsonResponse({ ok: true });
    }
    if (!env.TELEGRAM_GROUP_CHAT_ID) {
      await env.DB.prepare(
        "INSERT INTO system_settings (key, value, updated_at) VALUES ('telegram_group_chat_id', ?, ?) ON CONFLICT(key) DO NOTHING",
      ).bind(chatId, nowIso()).run();
    }
    if (await telegramGroupChatId(env) !== chatId) {
      await send("Binding grup gagal diverifikasi. Hubungi admin sistem.");
      return jsonResponse({ ok: true });
    }
    await send("Grup Telegram berhasil diikat ke Content-Automation Hub. Ketik /help untuk melihat perintah.");
    return jsonResponse({ ok: true });
  }

  const groupId = await telegramGroupChatId(env);
  if (!groupId || groupId !== chatId) {
    await send("Grup belum terdaftar. PM harus menjalankan /bind@NamaBot terlebih dahulu.");
    return jsonResponse({ ok: true });
  }
  const username = typeof from?.username === "string" ? from.username : "PM";
  const messageId = String(message.message_id ?? "");

  if (parsed.name === "help" || parsed.name === "start") {
    await send(
      "Content-Automation Chat Gateway\n" +
      "/ask <role> <pertanyaan> — tanya satu agen\n" +
      "/discuss <topik> — CEO memimpin diskusi maksimal tiga spesialis\n" +
      "/status — ringkasan sistem tanpa membangunkan AI\n" +
      "/agents — daftar agen aktif\n" +
      "/approvals — daftar approval menunggu\n" +
      "/approve <approval_id> — setujui\n" +
      "/reject <approval_id> <catatan> — tolak\n" +
      "/wake <hub_task_id> — bangunkan ulang task Cue yang masih queued\n" +
      "/help — bantuan"
    );
    return jsonResponse({ ok: true });
  }
  if (parsed.name === "status") {
    const [tasks, videos, approvals] = await Promise.all([
      env.DB.prepare("SELECT status, COUNT(*) AS count FROM tasks GROUP BY status").all<{ status: string; count: number }>(),
      env.DB.prepare("SELECT stage, COUNT(*) AS count FROM videos GROUP BY stage").all<{ stage: string; count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM approvals WHERE decision IS NULL").first<{ count: number }>(),
    ]);
    const taskSummary = (tasks.results ?? []).map((row) => row.status + ": " + row.count).join(" · ") || "belum ada";
    const videoSummary = (videos.results ?? []).map((row) => row.stage + ": " + row.count).join(" · ") || "belum ada";
    await send("Content-Automation Status\nTask — " + taskSummary + "\nVideo — " + videoSummary +
      "\nApproval pending — " + (approvals?.count ?? 0) + "\n\nPemeriksaan ini membaca D1 dan tidak memanggil model AI.");
    return jsonResponse({ ok: true });
  }
  if (parsed.name === "agents") {
    const agents = await env.DB.prepare("SELECT name, role, vendor, active, last_seen_at FROM agents ORDER BY role, name")
      .all<{ name: string; role: string; vendor: string; active: number; last_seen_at: string | null }>();
    const body = (agents.results ?? []).map((agent) =>
      (agent.active === 1 ? "● " : "○ ") + agent.role + " — " + agent.name + " (" + agent.vendor + ")"
    ).join("\n") || "Belum ada akun agen.";
    await send("Agen terdaftar\n" + body);
    return jsonResponse({ ok: true });
  }
  if (parsed.name === "approvals") {
    const rows = await env.DB.prepare(
      "SELECT a.id, a.stage, a.summary, v.topic FROM approvals a JOIN videos v ON v.id = a.video_id WHERE a.decision IS NULL ORDER BY a.requested_at LIMIT 10",
    ).all<{ id: string; stage: string; summary: string | null; topic: string }>();
    const body = (rows.results ?? []).map((row) =>
      row.id + " · " + row.stage + " · " + row.topic + (row.summary ? "\n" + row.summary.slice(0, 300) : "")
    ).join("\n\n") || "Tidak ada approval yang menunggu.";
    await send("Approval pending\n" + body);
    return jsonResponse({ ok: true });
  }
  if (parsed.name === "approve" || parsed.name === "reject") {
    const match = parsed.args.match(/^([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (!match) {
      await send("Format: /" + parsed.name + " <approval_id>" + (parsed.name === "reject" ? " <catatan>" : ""));
      return jsonResponse({ ok: true });
    }
    const result = await decideApproval(env, match[1], parsed.name as "approve" | "reject", match[2] ?? "", "pm-telegram");
    if (!result.ok) await send("Tidak dapat memproses approval: " + result.error);
    return jsonResponse({ ok: result.ok });
  }
  if (parsed.name === "wake") {
    const hubTaskId = parsed.args.trim();
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(hubTaskId)) {
      await send("Format: /wake <hub_task_id>");
      return jsonResponse({ ok: true });
    }
    const task = await env.DB.prepare(
      "SELECT t.id, t.to_agent, t.status, a.vendor FROM tasks t " +
        "JOIN agents a ON a.role = t.to_agent AND a.active = 1 WHERE t.id = ? LIMIT 1",
    ).bind(hubTaskId).first<{ id: string; to_agent: string; status: string; vendor: string }>();
    if (!task || task.vendor !== "cue" || (task.to_agent !== "ceo" && task.to_agent !== "animator")) {
      await send("Task tidak ditemukan atau role-nya tidak didukung adapter Cue.");
      return jsonResponse({ ok: true });
    }
    if (task.status !== "queued") {
      await send("Task " + hubTaskId + " tidak berstatus queued (status: " + task.status + "). Tidak dikirim ulang.");
      return jsonResponse({ ok: true });
    }
    const timestamp = nowIso();
    await env.DB.prepare(
      "INSERT INTO agent_dispatches (id, task_id, role, provider, status, attempts, created_at, updated_at) " +
        "VALUES (?, ?, ?, 'manus', 'pending', 0, ?, ?) " +
        "ON CONFLICT(task_id) DO UPDATE SET status = 'pending', attempts = 0, last_attempt_at = NULL, " +
        "next_attempt_at = NULL, dispatched_at = NULL, external_request_id = NULL, last_error = NULL, updated_at = excluded.updated_at",
    ).bind(newId("dsp_"), hubTaskId, task.to_agent, timestamp, timestamp).run();
    ctx.waitUntil(dispatchCueTask(env, hubTaskId));
    await send("Wake-up diminta untuk Cue " + task.to_agent + ". Hub task: " + hubTaskId + ". Hasil akan dikirim setelah agen menyelesaikannya.");
    return jsonResponse({ ok: true });
  }
  if (parsed.name === "ask") {
    const match = parsed.args.match(/^([a-z_]+)\s+([\s\S]+)$/i);
    if (!match) {
      await send("Format: /ask <role> <pertanyaan>\nRole: " + TELEGRAM_AGENT_ROLES.join(", "));
      return jsonResponse({ ok: true });
    }
    const role = match[1].toLowerCase();
    if (!(TELEGRAM_AGENT_ROLES as readonly string[]).includes(role)) {
      await send("Role tidak dikenal. Pilih: " + TELEGRAM_AGENT_ROLES.join(", "));
      return jsonResponse({ ok: true });
    }
    try {
      const created = await createTelegramChatTask(env, role as TelegramAgentRole, "chat_message", match[2].trim(), chatId, messageId, username);
      if (created.vendor === "cue" && (role === "ceo" || role === "animator")) {
        ctx.waitUntil(dispatchCueTask(env, created.taskId));
        await send("Pertanyaan masuk ke antrean " + role + " dan wake-up Cue sedang dikirim.\nTask ID: " + created.taskId +
          "\nBot akan memberi kabar ketika Manus menerima wake-up. Hasil baru muncul setelah task selesai melalui Hub.");
      } else {
        await send("Pertanyaan masuk ke antrean " + role + ".\nTask ID: " + created.taskId +
          "\nAkun Muse belum memiliki adapter wake-up otomatis; agen perlu mengambil task melalui koneksi MCP aktif.");
      }
    } catch (error) {
      await send("Tidak dapat membuat task: " + (error instanceof Error ? error.message : "kesalahan sistem"));
    }
    return jsonResponse({ ok: true });
  }
  if (parsed.name === "discuss") {
    if (!parsed.args || parsed.args.length > 1800) {
      await send("Format: /discuss <topik atau pertanyaan> (maksimal 1800 karakter).");
      return jsonResponse({ ok: true });
    }
    try {
      const created = await createTelegramChatTask(env, "ceo", "group_discussion", parsed.args, chatId, messageId, username);
      ctx.waitUntil(dispatchCueTask(env, created.taskId));
      await send("Diskusi masuk ke antrean CEO. Wake-up Cue sedang dikirim; CEO akan memilih maksimal tiga spesialis yang relevan.\nTask ID: " + created.taskId);
    } catch (error) {
      await send("Tidak dapat membuat diskusi: " + (error instanceof Error ? error.message : "kesalahan sistem"));
    }
    return jsonResponse({ ok: true });
  }
  await send("Perintah tidak dikenal. Ketik /help.");
  return jsonResponse({ ok: true });
}

async function telegramWebhook(request: Request, env: Env, ctx: WorkerExecutionContext): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_PM_USER_ID || !env.TELEGRAM_WEBHOOK_SECRET) {
    return jsonResponse({ error: "Telegram webhook memerlukan BOT_TOKEN, PM_USER_ID, dan WEBHOOK_SECRET." }, 503);
  }
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!constantTimeEqual(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET)) return jsonResponse({ error: "Webhook secret tidak valid." }, 401);
  let update: Record<string, unknown>;
  try { update = await request.json() as Record<string, unknown>; } catch { return jsonResponse({ error: "Body Telegram tidak valid." }, 400); }
  const incomingMessage = update.message as Record<string, unknown> | undefined;
  if (incomingMessage) return handleTelegramMessage(env, incomingMessage, ctx);

  const callback = update.callback_query as Record<string, unknown> | undefined;
  if (!callback) return jsonResponse({ ok: true });
  const callbackMessage = callback.message as Record<string, unknown> | undefined;
  const chat = callbackMessage?.chat as Record<string, unknown> | undefined;
  const from = callback.from as Record<string, unknown> | undefined;
  const allowedChats = [await telegramGroupChatId(env), env.TELEGRAM_PM_CHAT_ID].filter((value): value is string => Boolean(value));
  if (!allowedChats.includes(String(chat?.id ?? ""))) return jsonResponse({ error: "Chat tidak diizinkan." }, 403);
  if (String(from?.id ?? "") !== String(env.TELEGRAM_PM_USER_ID)) return jsonResponse({ error: "Pengguna bukan PM yang diizinkan." }, 403);
  const match = String(callback.data ?? "").match(/^(approve|reject):([a-zA-Z0-9_-]+)$/);
  if (!match) return jsonResponse({ ok: true });
  const result = await decideApproval(env, match[2], match[1] as "approve" | "reject", "Keputusan melalui Telegram", "pm-telegram");
  await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/answerCallbackQuery", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: String(callback.id ?? ""), text: result.ok ? "Keputusan tersimpan." : result.error ?? "Gagal menyimpan keputusan." }),
  });
  return jsonResponse({ ok: result.ok, error: result.error });
}
async function runStaleTaskSweep(env: Env): Promise<void> {
  const backup = await env.DB.prepare(
    "SELECT id FROM agents WHERE role = 'animator_backup' AND active = 1 LIMIT 1",
  ).first<{ id: string }>();
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const claimed = await env.DB.prepare(
    "SELECT id, parent_id, type, video_id, to_agent, title, payload, priority, attempt, due_at, updated_at " +
      "FROM tasks WHERE status = 'claimed' AND updated_at <= ? ORDER BY updated_at LIMIT 100",
  ).bind(cutoff).all<{
    id: string; parent_id: string | null; type: string; video_id: string | null; to_agent: string;
    title: string; payload: string; priority: string; attempt: number; due_at: string | null; updated_at: string;
  }>();

  for (const task of claimed.results ?? []) {
    const timestamp = nowIso();
    if (task.type === "render" && task.to_agent === "animator" && backup) {
      await queueAnimatorFailover(env, task, "stale_after_4h", timestamp);
      continue;
    }
    const action = task.type === "render" ? "needs_reassign" : "task_stale";
    const batch = await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET status = 'stale', updated_at = ? WHERE id = ? AND status = 'claimed' AND updated_at = ?")
        .bind(timestamp, task.id, task.updated_at),
      env.DB.prepare(
        "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
          "SELECT ?, 'system', 'task_status_stale', id, video_id, ? FROM tasks " +
          "WHERE id = ? AND status = 'stale' AND updated_at = ? AND changes() = 1",
      ).bind(timestamp, JSON.stringify({ previous_status: "claimed", new_status: "stale", previous_owner: task.to_agent }), task.id, timestamp),
      env.DB.prepare(
        "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
          "SELECT ?, 'system', ?, id, video_id, ? FROM tasks WHERE id = ? AND status = 'stale' AND updated_at = ? AND changes() = 1",
      ).bind(timestamp, action, JSON.stringify({ task_type: task.type, previous_owner: task.to_agent, escalation: task.type === "render" ? "ceo_review" : "pm_review" }), task.id, timestamp),
    ]);
    if ((batch[0]?.meta?.changes ?? 0) === 1) {
      await notifyPM(env, "Tugas " + task.id + " menjadi stale setelah lebih dari 4 jam. Pemilik: " + task.to_agent +
        (task.type === "render" ? (backup ? ". CEO/PM perlu meninjau." : ". Animator cadangan tidak aktif; perlu intervensi PM.") : "."));
    }
  }

  // Explicit failure and capacity blocks are retried on the backup during the next 15-minute sweep.
  if (backup) {
    const failed = await env.DB.prepare(
      "SELECT id, parent_id, video_id, title, payload, priority, attempt, due_at, status, blocked_reason " +
        "FROM tasks t WHERE t.type = 'render' AND t.to_agent = 'animator' " +
        "AND (t.status = 'failed' OR (t.status = 'blocked' AND t.blocked_reason IN ('limit', 'failed'))) " +
        "AND NOT EXISTS (SELECT 1 FROM tasks replacement WHERE replacement.reassigned_from = t.id) " +
        "ORDER BY t.updated_at LIMIT 100",
    ).all<{
      id: string; parent_id: string | null; video_id: string | null; title: string; payload: string;
      priority: string; attempt: number; due_at: string | null; status: string; blocked_reason: string | null;
    }>();
    for (const task of failed.results ?? []) {
      await queueAnimatorFailover(env, task, task.status === "failed" ? "render_failed" : "render_capacity_or_failure");
    }
  }
}

async function queueAnimatorFailover(
  env: Env,
  task: {
    id: string; parent_id: string | null; video_id: string | null; title: string; payload: string;
    priority: string; attempt: number; due_at: string | null; status?: string; updated_at?: string;
  },
  reason: string,
  timestamp = nowIso(),
): Promise<void> {
  const replacementId = newId("tsk_");
  const previousStatus = task.status ?? "claimed";
  const update = previousStatus === "claimed"
    ? env.DB.prepare(
        "UPDATE tasks SET status = 'superseded', updated_at = ? WHERE id = ? AND status = 'claimed' AND updated_at = ?",
      ).bind(timestamp, task.id, task.updated_at)
    : env.DB.prepare(
        "UPDATE tasks SET status = 'superseded', updated_at = ? WHERE id = ? AND status = ? " +
          "AND NOT EXISTS (SELECT 1 FROM tasks replacement WHERE replacement.reassigned_from = tasks.id)",
      ).bind(timestamp, task.id, previousStatus);
  const batch = await env.DB.batch([
    update,
    env.DB.prepare(
      "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
        "SELECT ?, 'system', 'task_status_superseded', id, video_id, ? FROM tasks " +
        "WHERE id = ? AND status = 'superseded' AND updated_at = ? AND changes() = 1",
    ).bind(timestamp, JSON.stringify({
      previous_status: previousStatus,
      new_status: "superseded",
      previous_owner: "animator",
      failover: "animator_backup",
      reason,
    }), task.id, timestamp),
    env.DB.prepare(
      "INSERT INTO tasks (id, parent_id, video_id, type, title, payload, priority, from_agent, to_agent, status, attempt, reassigned_from, created_at, updated_at, due_at) " +
        "SELECT ?, ?, video_id, type, title || ' [FAILOVER]', payload, priority, 'system', 'animator_backup', 'queued', attempt + 1, id, ?, ?, due_at " +
        "FROM tasks WHERE id = ? AND status = 'superseded' AND updated_at = ? AND changes() = 1",
    ).bind(replacementId, task.parent_id ?? task.id, timestamp, timestamp, task.id, timestamp),
    env.DB.prepare(
      "INSERT INTO events (ts, actor, action, task_id, video_id, detail) " +
        "SELECT ?, 'system', 'task_failover_queued', id, video_id, ? FROM tasks WHERE id = ? AND status = 'queued'",
    ).bind(timestamp, JSON.stringify({
      previous_task_id: task.id,
      from_role: "animator",
      to_role: "animator_backup",
      reason,
    }), replacementId),
  ]);
  if ((batch[0]?.meta?.changes ?? 0) === 1 && (batch[2]?.meta?.changes ?? 0) === 1) {
    await notifyPM(env, "Failover render otomatis: " + task.id + " dialihkan ke " + replacementId +
      " pada animator_backup. Alasan: " + reason + ".");
  }
}

async function createDailyCEOReportTask(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const exists = await env.DB.prepare("SELECT id FROM tasks WHERE type = 'daily_report' AND created_at LIKE ? LIMIT 1").bind(today + "%").first<{ id: string }>();
  if (exists) return;
  const timestamp = nowIso(); const id = newId("tsk_");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tasks (id, type, title, payload, priority, from_agent, to_agent, status, attempt, created_at, updated_at) VALUES (?, 'daily_report', ?, ?, 'normal', 'system', 'ceo', 'queued', 1, ?, ?)").bind(id, "Laporan harian hub " + today, JSON.stringify({ report_date: today, instruction: "Ringkas antrean tugas, approval pending, dan aktivitas video. Jangan mengubah state." }), timestamp, timestamp),
    env.DB.prepare("INSERT INTO events (ts, actor, action, task_id, detail) VALUES (?, 'system', 'daily_report_queued', ?, ?)").bind(timestamp, id, JSON.stringify({ report_date: today })),
  ]);
}
export default {
  async scheduled(controller: { cron: string }, env: Env, ctx: WorkerExecutionContext) {
    if (controller.cron === "*/15 * * * *") {
      ctx.waitUntil(Promise.all([runStaleTaskSweep(env), runAgentDispatchSweep(env)]));
    }
    if (controller.cron === "0 2 * * *") ctx.waitUntil(createDailyCEOReportTask(env));
  },
  async fetch(request: Request, env: Env, ctx: WorkerExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/telegram/webhook" && request.method === "POST") return telegramWebhook(request, env, ctx);
    if (url.pathname.startsWith("/pm/")) return pmRoute(request, env, url);
    const uploadMatch = url.pathname.match(/^\/artifacts\/upload\/([^/]+)$/);
    if (uploadMatch && request.method === "PUT") return artifactUploadRoute(request, env, decodeURIComponent(uploadMatch[1]));
    const downloadMatch = url.pathname.match(/^\/artifacts\/([^/]+)\/download$/);
    if (downloadMatch && request.method === "GET") return artifactDownloadRoute(request, env, decodeURIComponent(downloadMatch[1]));
    if (url.pathname === "/health" && request.method === "GET") {
      try {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return jsonResponse({
          status: "ok",
          service: "content-automation-hub",
          database: "healthy",
          artifact_storage: env.ARTIFACTS ? "bound" : "missing",
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

    const handler = createMcpHandler(() => createServer(agent, env, url.origin, ctx));
    return handler(request, env, ctx as never);
  },
};