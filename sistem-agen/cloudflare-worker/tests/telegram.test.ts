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
test("formats attributed legacy roles as inactive after migration", () => {
  const output = formatTelegramAgentReply("strategist", "done", { answer: "Tiga ide konten." }, "tsk_123");
  assert.match(output, /Legacy Strategist — inactive after Muse migration/);
  assert.match(output, /Tiga ide konten/);
  assert.match(output, /tsk_123/);
});
test("formats replies with the three active Muse identities", () => {
  const cases = [
    ["ceo", "Muse Controller"],
    ["animator", "Animator Primary — Muse"],
    ["animator_backup", "Animator Backup — Muse"],
  ] as const;
  for (const [role, label] of cases) {
    const output = formatTelegramAgentReply(role, "done", { answer: "OK" }, "tsk_789");
    assert.match(output, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
test("blocked results retain the reason", () => {
  const output = formatTelegramAgentReply("animator", "blocked", { notes: "Kuota render habis." }, "tsk_456", "limit");
  assert.match(output, /TUGAS TERTAHAN/);
  assert.match(output, /limit/);
});
