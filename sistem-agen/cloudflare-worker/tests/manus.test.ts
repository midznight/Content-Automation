import assert from "node:assert/strict";
import test from "node:test";
import { ManusApiError, sendManusAgentMessage } from "../src/manus";

test("sends a wake-up to the persistent agent task and preserves connectors", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await sendManusAgentMessage(
    "test-api-key",
    "cue-main-task",
    "tsk_existing_123",
    "ceo",
    "Telegram chat: test",
    async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, request_id: "req_123" }), { status: 200 });
    },
  );

  assert.equal(capturedUrl, "https://api.manus.ai/v2/task.sendMessage");
  assert.equal(capturedInit?.method, "POST");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-manus-api-key"), "test-api-key");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.task_id, "cue-main-task");
  assert.match(body.message.content, /tsk_existing_123/);
  assert.match(body.message.content, /claim_task/);
  assert.equal("connectors" in body.message, false);
  assert.deepEqual(result, { requestId: "req_123" });
});

test("rejects an unauthorized Manus API request without exposing the API key", async () => {
  await assert.rejects(
    () => sendManusAgentMessage(
      "never-print-this-key",
      "cue-main-task",
      "tsk_existing_123",
      "ceo",
      "Test",
      async () => new Response(JSON.stringify({ ok: false, error: { message: "Unauthorized" } }), { status: 401 }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ManusApiError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /never-print-this-key/);
      return true;
    },
  );
});

test("does not call the network with missing configuration", async () => {
  let called = false;
  await assert.rejects(
    () => sendManusAgentMessage(
      "",
      "cue-main-task",
      "tsk_existing_123",
      "ceo",
      "Test",
      async () => {
        called = true;
        return new Response("{}");
      },
    ),
    /MANUS_API_KEY is not configured/,
  );
  assert.equal(called, false);
});
