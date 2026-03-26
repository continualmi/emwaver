import type { VerifiedIdentity } from "./auth";
import { fetchContinualPlatform } from "./continualPlatformClient";

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

type ToolCallAccumulator = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

function buildContinualPayload(payload: Record<string, unknown>, usage: UsageLabels) {
  return {
    ...payload,
    _continual: {
      productKey: "emwaver",
      surfaceKey: usage.surfaceKey,
      workloadKey: usage.workloadKey,
      ...(usage.sourceRef ? { sourceRef: usage.sourceRef } : {}),
      ...(usage.metadata ? { metadata: usage.metadata } : {}),
    },
  };
}

async function fetchAgentStream(identity: VerifiedIdentity, payload: Record<string, unknown>, usage: UsageLabels) {
  const response = await fetchContinualPlatform("/api/platform/agent/chat/stream", {
    method: "POST",
    identity,
    body: buildContinualPayload(payload, usage),
  });
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

function accumulateToolCalls(
  accumulators: ToolCallAccumulator[],
  rawToolCalls: unknown,
) {
  if (!Array.isArray(rawToolCalls)) return;
  for (const entry of rawToolCalls) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as {
      index?: unknown;
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const index = typeof record.index === "number" && Number.isFinite(record.index)
      ? Math.max(0, Math.floor(record.index))
      : accumulators.length;
    while (accumulators.length <= index) {
      accumulators.push({
        id: "",
        type: "function",
        function: {
          name: "",
          arguments: "",
        },
      });
    }
    const target = accumulators[index];
    if (typeof record.id === "string" && record.id) target.id = record.id;
    if (record.type === "function") target.type = "function";
    if (record.function && typeof record.function === "object") {
      if (typeof record.function.name === "string") {
        target.function.name += record.function.name;
      }
      if (typeof record.function.arguments === "string") {
        target.function.arguments += record.function.arguments;
      }
    }
  }
}

export function openAIModel() {
  const model = (process.env.MODEL_NAME || process.env.OPENAI_MODEL || "").trim();
  if (!model) throw new Error("Missing MODEL_NAME");
  return model;
}

export async function createChatCompletion(
  identity: VerifiedIdentity,
  payload: Record<string, unknown>,
  usage: UsageLabels,
) {
  const response = await fetchAgentStream(identity, payload, usage);
  let model = "";
  let id = "";
  let created = Math.floor(Date.now() / 1000);
  let role = "assistant";
  let usageBlock: Record<string, unknown> | undefined;
  const parts: string[] = [];
  const toolCalls: ToolCallAccumulator[] = [];

  await readSSEStream(response, async (chunk) => {
    if (typeof chunk.id === "string" && chunk.id) id = chunk.id;
    if (typeof chunk.model === "string" && chunk.model) model = chunk.model;
    if (typeof chunk.created === "number" && Number.isFinite(chunk.created)) {
      created = Math.floor(chunk.created);
    }
    if (chunk.usage && typeof chunk.usage === "object" && !Array.isArray(chunk.usage)) {
      usageBlock = chunk.usage as Record<string, unknown>;
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices as Array<Record<string, unknown>> : [];
    const first = choices[0];
    if (!first) return;

    const delta = (first.delta && typeof first.delta === "object")
      ? first.delta as Record<string, unknown>
      : (first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : null);
    if (!delta) return;

    if (typeof delta.role === "string" && delta.role) role = delta.role;
    if (typeof delta.content === "string" && delta.content) parts.push(delta.content);
    accumulateToolCalls(toolCalls, delta.tool_calls);
  });

  const hasToolCalls = toolCalls.some((toolCall) => toolCall.id || toolCall.function.name || toolCall.function.arguments);
  return {
    id: id || `chatcmpl_emwaver_${Date.now()}`,
    object: "chat.completion",
    created,
    model: model || openAIModel(),
    choices: [
      {
        index: 0,
        message: {
          role,
          content: parts.join(""),
          ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: "stop",
      },
    ],
    ...(usageBlock ? { usage: usageBlock } : {}),
  } as Record<string, unknown>;
}

export async function createChatCompletionStream(
  identity: VerifiedIdentity,
  payload: Record<string, unknown>,
  onChunk: (chunk: Record<string, unknown>) => Promise<void> | void,
  usage: UsageLabels,
) {
  const response = await fetchAgentStream(identity, payload, usage);
  await readSSEStream(response, onChunk);
}

export type { ChatMessage };
