import assert from "node:assert/strict";
import test from "node:test";
import { formatTelegramAgentReply, parseTelegramCommand } from "../src/telegram";

test("parses group command with bot username and preserves multiline arguments", () => {
  assert.deepEqual(parseTelegramCommand("/ask@ContentHubBot strategist\nBuat tiga ide konten"), {
    name: "ask", args: "strategist\nBuat tiga ide konten",
  });
});
test("ignores ordinary group messages and commands with leading whitespace", () => {
  assert.equal(parseTelegramCommand("Halo semua, selamat pagi"), null);
  assert.equal(parseTelegramCommand(" /ask strategist hi"), null);
});
test("parses commands case-insensitively", () => {
  assert.deepEqual(parseTelegramCommand("/STATUS@contenthubbot"), { name: "status", args: "" });
});
test("formats attributed agent replies", () => {
  const output = formatTelegramAgentReply("strategist", "done", { answer: "Tiga ide konten." }, "tsk_123");
  assert.match(output, /Strategist — Muse/);
  assert.match(output, /Tiga ide konten/);
  assert.match(output, /tsk_123/);
});
test("blocked results retain the reason", () => {
  const output = formatTelegramAgentReply("animator", "blocked", { notes: "Kuota render habis." }, "tsk_456", "limit");
  assert.match(output, /TUGAS TERTAHAN/);
  assert.match(output, /limit/);
});
