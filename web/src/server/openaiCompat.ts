import type { VerifiedIdentity } from "./auth";
import { getModelApiKey, getModelBaseUrl, getModelRequestTimeoutMs } from "./env";

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

type UsageLabels = {
  surfaceKey: string;
  workloadKey: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
};

type StreamChunk = Record<string, unknown>;

function buildHeaders() {
  const apiKey = getModelApiKey().trim();
  if (!apiKey) {
    throw new Error("Missing MODEL_API_KEY or OPENROUTER_API_KEY");
  }
  return {
    "content-type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function requestModel(args: {
  body: Record<string, unknown>;
  stream: boolean;
}) {
  const controller = new AbortController();
  const timeoutMs = getModelRequestTimeoutMs();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let timedOut = false;
  controller.signal.addEventListener("abort", () => {
    timedOut = true;
  }, { once: true });

  try {
    const response = await fetch(`${getModelBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        ...args.body,
        ...(args.stream ? { stream: true } : {}),
      }),
    });
    return response;
  } catch (error) {
    if (timedOut) {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchAgentStream(payload: Record<string, unknown>) {
  const response = await requestModel({ body: payload, stream: true });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response;
}

async function readSSEStream(
  response: Response,
  onChunk: (chunk: StreamChunk) => Promise<void> | void,
) {
  if (!response.body) {
    throw new Error("Streaming response missing body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let sawDone = false;
  async function consumeBuffer() {
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
        if (line === "[DONE]") {
          sawDone = true;
          return;
        }
        if (!line) continue;
        await onChunk(JSON.parse(line) as StreamChunk);
      }
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      await consumeBuffer();
      if (sawDone) return;
    }

    buffer += decoder.decode();
    await consumeBuffer();
  } finally {
    reader.releaseLock();
  }
}

export function openAIModel() {
  const model = (process.env.MODEL_NAME || process.env.OPENAI_MODEL || "").trim();
  if (!model) throw new Error("Missing MODEL_NAME");
  return model;
}

export async function createChatCompletion(
  _identity: VerifiedIdentity,
  payload: Record<string, unknown>,
  _usage: UsageLabels,
) {
  void _identity;
  void _usage;
  const response = await requestModel({ body: payload, stream: false });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export async function createChatCompletionStream(
  _identity: VerifiedIdentity,
  payload: Record<string, unknown>,
  onChunk: (chunk: Record<string, unknown>) => Promise<void> | void,
  _usage: UsageLabels,
) {
  void _identity;
  void _usage;
  const response = await fetchAgentStream(payload);
  await readSSEStream(response, onChunk);
}

export type { ChatMessage };
