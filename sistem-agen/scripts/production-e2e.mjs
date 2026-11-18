import { createHash, randomBytes, randomUUID } from "node:crypto";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const database = process.env.CLOUDFLARE_D1_DATABASE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const worker = (process.env.CONTENT_HUB_URL || "https://content-automation-hub.midzpribadi.workers.dev").replace(/\/$/, "");
if (!account || !database || !apiToken) throw new Error("Cloudflare E2E environment is incomplete.");

const runId = randomUUID().replaceAll("-", "").slice(0, 16);
const agentId = "agt_e2e_" + runId;
const agentName = "e2e-ceo-" + runId;
const agentKey = "agt_live_" + randomBytes(32).toString("base64url");
const keyHash = createHash("sha256").update(agentKey.trim()).digest("hex");
const topic = "E2E QA ONLY " + runId + " — jangan diproduksi atau dipublikasikan";
let sessionId;
let protocolVersion = "2025-03-26";
let initialized = false;
let rpcId = 0;

async function d1(sql, params = []) {
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + account + "/d1/database/" + database + "/query", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiToken, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params: params.map(String) }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    const reason = body?.errors?.map((x) => x.message).join("; ") || ("HTTP " + response.status);
    throw new Error("D1 request failed: " + reason);
  }
  return body.result?.[0] || { results: [] };
}

function parseResponse(raw, contentType, id) {
  if (!raw.trim()) return null;
  if (contentType.includes("text/event-stream")) {
    const messages = [];
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (data && data !== "[DONE]") {
        try { messages.push(JSON.parse(data)); } catch { /* Ignore keepalive frames. */ }
      }
    }
    return messages.findLast((x) => x?.id === id) || messages.findLast((x) => x?.jsonrpc === "2.0") || null;
  }
  return JSON.parse(raw);
}

async function rpc(method, params, notification = false) {
  const id = notification ? undefined : ++rpcId;
  const headers = {
    Authorization: "Bearer " + agentKey,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Origin: new URL(worker).origin,
  };
  if (sessionId) headers["MCP-Session-Id"] = sessionId;
  if (initialized) headers["MCP-Protocol-Version"] = protocolVersion;
  const payload = { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) };
  const response = await fetch(worker + "/mcp", { method: "POST", headers, body: JSON.stringify(payload) });
  const raw = await response.text();
  if (!response.ok) throw new Error("MCP " + method + " returned HTTP " + response.status + ": " + raw.slice(0, 300));
  const nextSession = response.headers.get("mcp-session-id");
  if (nextSession) sessionId = nextSession;
  const negotiated = response.headers.get("mcp-protocol-version");
  if (negotiated) protocolVersion = negotiated;
  if (notification) return null;
  const parsed = parseResponse(raw, response.headers.get("content-type") || "", id);
  if (!parsed) throw new Error("MCP " + method + " returned no JSON-RPC response.");
  if (parsed.error) throw new Error("MCP error: " + (parsed.error.message || "unknown"));
  return parsed;
}

function toolData(response, name) {
  const result = response?.result;
  if (result?.isError) throw new Error(name + " failed: " + (result.content || []).map((x) => x.text || "").join(" "));
  if (result?.structuredContent) return result.structuredContent;
  const text = (result?.content || []).find((x) => x.type === "text")?.text;
  if (text) return JSON.parse(text);
  return result;
}

async function cleanup() {
  const videos = (await d1("SELECT id FROM videos WHERE topic = ?", [topic])).results || [];
  let auditEventsRetained = 0;
  for (const video of videos) {
    auditEventsRetained += Number((await d1("SELECT COUNT(*) AS count FROM events WHERE video_id = ?", [video.id])).results?.[0]?.count ?? 0);
    for (const table of ["approvals", "metrics", "artifacts", "tasks"]) {
      await d1("DELETE FROM " + table + " WHERE video_id = ?", [video.id]);
    }
    await d1("DELETE FROM videos WHERE id = ?", [video.id]);
  }
  await d1("DELETE FROM agents WHERE id = ?", [agentId]);
  const left = (await d1("SELECT (SELECT COUNT(*) FROM videos WHERE topic = ?) AS videos, (SELECT COUNT(*) FROM agents WHERE id = ?) AS agents", [topic, agentId])).results?.[0];
  if (Number(left?.videos) !== 0 || Number(left?.agents) !== 0) throw new Error("Test records remain after cleanup.");
  console.log("PASS: append-only audit events retained for traceability (" + auditEventsRetained + " rows).");
}

let failed = false;
try {
  const healthResponse = await fetch(worker + "/health");
  const health = await healthResponse.json();
  if (!healthResponse.ok || health.status !== "ok" || health.database !== "healthy" || health.artifact_storage !== "bound") {
    throw new Error("Production health check failed.");
  }
  const pmUnauthenticated = await fetch(worker + "/pm/approvals");
  if (pmUnauthenticated.status !== 401) throw new Error("Unauthenticated PM endpoint expected 401, got " + pmUnauthenticated.status + ".");

  await d1("INSERT INTO agents (id, name, role, vendor, key_hash, active, created_at) VALUES (?, ?, 'ceo', 'e2e-temporary', ?, 1, ?)",
    [agentId, agentName, keyHash, new Date().toISOString()]);

  const init = await rpc("initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "content-automation-production-e2e", version: "1.0.0" },
  });
  if (!init.result?.protocolVersion) throw new Error("MCP initialize did not negotiate a protocol version.");
  protocolVersion = init.result.protocolVersion;
  initialized = true;
  await rpc("notifications/initialized", undefined, true);

  const listed = await rpc("tools/list", {});
  const tools = listed.result?.tools || [];
  for (const required of ["whoami", "create_video", "request_approval"]) {
    if (!tools.some((tool) => tool.name === required)) throw new Error("MCP tool missing: " + required);
  }

  const identity = toolData(await rpc("tools/call", { name: "whoami", arguments: {} }), "whoami");
  if (identity.role !== "ceo" || identity.name !== agentName) throw new Error("MCP identity mismatch.");

  const created = toolData(await rpc("tools/call", {
    name: "create_video",
    arguments: { topic, pillar: "QA-only" },
  }), "create_video");
  if (typeof created.video_id !== "string" || !created.video_id.startsWith("vid_")) throw new Error("create_video did not return a valid ID.");

  const approval = toolData(await rpc("tools/call", {
    name: "request_approval",
    arguments: {
      video_id: created.video_id,
      stage: "topic",
      summary: "Uji integrasi otomatis: memverifikasi record video, permintaan approval, dan persistensi D1. Bukan konten untuk diterbitkan.",
    },
  }), "request_approval");
  if (approval.status !== "pending" || approval.next_video_stage !== "awaiting_topic_approval") throw new Error("Topic approval did not enter the pending state.");

  const videoRows = (await d1("SELECT stage FROM videos WHERE id = ?", [created.video_id])).results || [];
  const approvalRows = (await d1("SELECT decision FROM approvals WHERE id = ? AND video_id = ?", [approval.approval_id, created.video_id])).results || [];
  if (videoRows.length !== 1 || videoRows[0].stage !== "awaiting_topic_approval" || approvalRows.length !== 1 || approvalRows[0].decision !== null) {
    throw new Error("D1 persistence verification failed.");
  }

  console.log("PASS: Worker health and R2 binding.");
  console.log("PASS: unauthenticated PM endpoint rejects requests with HTTP 401.");
  console.log("PASS: MCP initialize, tools/list, and CEO whoami.");
  console.log("PASS: create_video and request_approval persisted to D1.");
} catch (error) {
  failed = true;
  console.error("PRODUCTION E2E FAILED: " + (error instanceof Error ? error.message : "unknown error"));
} finally {
  if (sessionId) {
    try {
      await fetch(worker + "/mcp", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + agentKey,
          "MCP-Session-Id": sessionId,
          "MCP-Protocol-Version": protocolVersion,
        },
      });
    } catch { /* The server can expire the session automatically. */ }
  }
  try {
    await cleanup();
    console.log("PASS: temporary test agent and QA video/approval/audit records cleaned up.");
  } catch (error) {
    failed = true;
    console.error("CLEANUP FAILED: " + (error instanceof Error ? error.message : "unknown error"));
  }
  void agentKey;
}

if (failed) process.exitCode = 1;
