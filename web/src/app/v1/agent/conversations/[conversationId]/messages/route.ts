import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { agentStore } from "@/server/store/agent";

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();
  const { conversationId } = await context.params;

  const conversation = agentStore.getConversation(conversationId);
  if (!conversation || conversation.firebase_uid !== identity.uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ messages: agentStore.listMessages(conversationId, identity.uid) });
}

export async function POST(request: NextRequest, context: Context) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();
  const { conversationId } = await context.params;

  const conversation = agentStore.getConversation(conversationId);
  if (!conversation || conversation.firebase_uid !== identity.uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const role = (payload as Record<string, unknown>).role;
  const content = (payload as Record<string, unknown>).content;
  const createdAtRaw = (payload as Record<string, unknown>).created_at_ms;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return NextResponse.json({ error: "Invalid 'role'" }, { status: 400 });
  }
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Invalid 'content'" }, { status: 400 });
  }
  const created_at_ms = createdAtRaw == null ? undefined : Number.parseInt(String(createdAtRaw), 10);
  if (createdAtRaw != null && Number.isNaN(created_at_ms)) {
    return NextResponse.json({ error: "Invalid 'created_at_ms'" }, { status: 400 });
  }

  return NextResponse.json({
    message: agentStore.appendMessage({
      conversation_id: conversationId,
      firebase_uid: identity.uid,
      role,
      content,
      created_at_ms,
    }),
  });
}
