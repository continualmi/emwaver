type ChatMessage = {
  role: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

function baseUrl() {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
}

export function openAIModel() {
  const model = (process.env.OPENAI_MODEL || "").trim();
  if (!model) throw new Error("Missing OPENAI_MODEL");
  return model;
}

function headers() {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

export async function createChatCompletion(payload: Record<string, unknown>) {
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function createChatCompletionStream(
  payload: Record<string, unknown>,
  onChunk: (chunk: Record<string, unknown>) => Promise<void> | void,
) {
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...payload, stream: true }),
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const eventBlock = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLines = eventBlock
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      for (const line of dataLines) {
        if (line === "[DONE]") return;
        if (!line) continue;
        await onChunk(JSON.parse(line) as Record<string, unknown>);
      }
    }
  }
}

export type { ChatMessage };
