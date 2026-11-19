export interface TelegramCommand {
  name: string;
  args: string;
}

/** Parse explicit slash commands only. Ordinary group chat never wakes an agent. */
export function parseTelegramCommand(text: string): TelegramCommand | null {
  if (!text.startsWith("/")) return null;
  const match = text.trimEnd().match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

const ROLE_LABELS: Record<string, string> = {
  ceo: "Muse Controller",
  strategist: "Legacy Strategist — inactive after Muse migration",
  fact_checker: "Legacy Fact Checker — inactive after Muse migration",
  animator: "Animator Primary — Muse",
  animator_backup: "Animator Backup — Muse",
  analyst: "Legacy Analyst — inactive after Muse migration",
  social: "Legacy Social — inactive after Muse migration",
};

export function formatTelegramAgentReply(
  role: string, status: string, result: Record<string, unknown>, taskId: string, blockedReason?: string,
): string {
  const fields = ["answer", "summary", "response", "reply", "message", "recommendation", "final", "notes"];
  let body = "";
  for (const key of fields) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) { body = value.trim(); break; }
  }
  if (!body) {
    const entries = Object.entries(result).filter(([key]) => key !== "debug" && key !== "internal");
    body = entries.length ? JSON.stringify(Object.fromEntries(entries), null, 2) : "Agen mengirim hasil kosong.";
  }
  if (status === "blocked") body = "TUGAS TERTAHAN" + (blockedReason ? " (" + blockedReason + ")" : "") + "\n\n" + body;
  if (status === "failed") body = "TUGAS GAGAL\n\n" + body;
  if (body.length > 3000) body = body.slice(0, 2980) + "\n… (hasil dipotong; lihat task di Hub)";
  return (ROLE_LABELS[role] ?? role) + "\nTask: " + taskId + "\n\n" + body;
}
