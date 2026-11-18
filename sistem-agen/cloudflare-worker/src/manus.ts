export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ManusApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ManusApiError";
  }
}

/**
 * Sends a message to the persistent main conversation of a Cue/Manus agent.
 * Omitting message.connectors intentionally preserves the connector selection
 * already configured on the agent's persistent task (including the Hub MCP).
 */
export async function sendManusAgentMessage(
  apiKey: string,
  agentMainTaskId: string,
  hubTaskId: string,
  role: string,
  title: string,
  fetcher: FetchLike = fetch,
): Promise<{ requestId: string | null }> {
  if (!apiKey.trim()) throw new Error("MANUS_API_KEY is not configured.");
  if (!agentMainTaskId.trim()) throw new Error("Manus agent main task ID is not configured.");

  const content = [
    "[CONTENT-AUTOMATION HUB — TASK WAKE-UP]",
    "A task already exists in the Hub queue. Do not create a duplicate task.",
    "Hub task ID: " + hubTaskId,
    "Assigned role: " + role,
    "Task title: " + title,
    "",
    "Use the existing Hub MCP connector in this persistent agent session.",
    "1. Call whoami, then inbox with status=\"queued\" and a sufficient limit.",
    "2. Find exactly the Hub task ID above. If it is still queued, call claim_task for that exact ID.",
    "3. Read the claimed task payload and follow the existing role prompt and Hub rules.",
    "4. Complete it through submit_result (done, blocked, or failed).",
    "5. For a chat_message, answer the PM directly and submit result.answer. Do not change the video pipeline or publish content.",
    "If the task is missing or no longer queued, do not create another task; report that no action was needed.",
  ].join("\n");

  const response = await fetcher("https://api.manus.ai/v2/task.sendMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-manus-api-key": apiKey,
    },
    body: JSON.stringify({
      task_id: agentMainTaskId,
      message: { content },
    }),
  });

  const raw = await response.text();
  let payload: {
    ok?: boolean;
    request_id?: string;
    error?: { code?: string; message?: string };
  } = {};
  try {
    payload = raw ? JSON.parse(raw) as typeof payload : {};
  } catch {
    payload = {};
  }

  if (!response.ok || payload.ok !== true) {
    const detail = payload.error?.message || payload.error?.code || "Manus API rejected the wake-up request.";
    throw new ManusApiError(response.status, detail.slice(0, 300));
  }

  return { requestId: typeof payload.request_id === "string" ? payload.request_id : null };
}
