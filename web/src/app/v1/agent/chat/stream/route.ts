import { type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { createChatCompletionStream, openAIModel } from "@/server/openaiCompat";
import { agentStore } from "@/server/store/agent";

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(run: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>) {
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          await run(controller);
        } finally {
          controller.close();
        }
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    },
  );
}

type RequestPayload = {
  conversation_id?: string;
  message?: string;
  max_tokens?: number;
  temperature?: number;
};

function validatePayload(payload: RequestPayload) {
  const conversationId = String(payload.conversation_id || "");
  const userContent = String(payload.message || "");
  const maxTokens = Number.parseInt(String(payload.max_tokens ?? 512), 10);
  const temperature = Number.parseFloat(String(payload.temperature ?? 0.2));
  if (!conversationId) throw new Error("Missing 'conversation_id'");
  if (!userContent.trim()) throw new Error("Missing 'message'");
  return { conversationId, userContent, maxTokens, temperature };
}

async function handlePlainStream(
  identity: Awaited<ReturnType<typeof requireIdentity>>,
  conversationId: string,
  userContent: string,
  maxTokens: number,
  temperature: number,
) {
  if (!identity) {
    throw new Error("Unauthorized");
  }
  agentStore.appendMessage({
    conversation_id: conversationId,
    firebase_uid: identity.uid,
    role: "user",
    content: userContent,
  });

  const model = openAIModel();
  const history = agentStore.listMessages(conversationId, identity.uid).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return streamResponse(async (controller) => {
    const encoder = new TextEncoder();
    const parts: string[] = [];
    try {
      await createChatCompletionStream(identity, {
        model,
        messages: history,
        max_tokens: maxTokens,
        temperature,
      }, async (chunk) => {
        const choices = (chunk.choices as Array<Record<string, unknown>> | undefined) || [];
        const delta = ((choices[0]?.delta as Record<string, unknown> | undefined)?.content as string | undefined) || "";
        if (delta) {
          parts.push(delta);
          controller.enqueue(encoder.encode(sse("delta", { text: delta })));
        }
      }, { surfaceKey: "agent", workloadKey: "chat" });

      const full = parts.join("").trim();
      if (!full) {
        controller.enqueue(encoder.encode(sse("error", { error: "Upstream produced no content" })));
        return;
      }

      const message = agentStore.appendMessage({
        conversation_id: conversationId,
        firebase_uid: identity.uid,
        role: "assistant",
        content: full,
      });

      controller.enqueue(encoder.encode(sse("done", { message, model })));
    } catch (error) {
      controller.enqueue(encoder.encode(sse("error", { error: String(error) })));
    }
  });
}

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = (await request.json().catch(() => null)) as RequestPayload | null;
  if (!payload || typeof payload !== "object") {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), { status: 400 });
  }

  let validated;
  try {
    validated = validatePayload(payload);
  } catch (error) {
    return new Response(JSON.stringify({ error: String((error as Error).message || error) }), { status: 400 });
  }

  const conversation = agentStore.getConversation(validated.conversationId);
  if (!conversation || conversation.firebase_uid !== identity.uid) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  return handlePlainStream(identity, validated.conversationId, validated.userContent, validated.maxTokens, validated.temperature);
}

export async function PUT(request: NextRequest) {
  return POST(request);
}
