import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { createChatCompletion, openAIModel } from "@/server/openaiCompat";
import { agentStore } from "@/server/store/agent";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const conversationId = String((payload as Record<string, unknown>).conversation_id || "");
  const userContent = String((payload as Record<string, unknown>).message || "");
  const maxTokens = Number.parseInt(String((payload as Record<string, unknown>).max_tokens ?? 512), 10);
  const temperature = Number.parseFloat(String((payload as Record<string, unknown>).temperature ?? 0.2));
  if (!conversationId) return NextResponse.json({ error: "Missing 'conversation_id'" }, { status: 400 });
  if (!userContent.trim()) return NextResponse.json({ error: "Missing 'message'" }, { status: 400 });

  const conversation = agentStore.getConversation(conversationId);
  if (!conversation || conversation.firebase_uid !== identity.uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  agentStore.appendMessage({
    conversation_id: conversationId,
    firebase_uid: identity.uid,
    role: "user",
    content: userContent,
  });

  try {
    const model = openAIModel();
    const messages = agentStore
      .listMessages(conversationId, identity.uid)
      .map((message) => ({ role: message.role, content: message.content }));

    const response = await createChatCompletion({
      model,
      messages,
      max_tokens: Number.isNaN(maxTokens) ? 512 : maxTokens,
      temperature: Number.isNaN(temperature) ? 0.2 : temperature,
    });

    const choices = (response.choices as Array<Record<string, unknown>> | undefined) || [];
    const assistantContent = String(((choices[0]?.message as Record<string, unknown> | undefined)?.content as string | undefined) || "").trim();
    if (!assistantContent) {
      throw new Error("Upstream response missing message content");
    }

    const message = agentStore.appendMessage({
      conversation_id: conversationId,
      firebase_uid: identity.uid,
      role: "assistant",
      content: assistantContent,
    });

    return NextResponse.json({ message, model });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
