import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { agentStore } from "@/server/store/agent";

type Context = { params: Promise<{ conversationId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();
  const { conversationId } = await context.params;

  const conversation = agentStore.getConversation(conversationId);
  if (!conversation || conversation.firebase_uid !== identity.uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  if (payload && typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const updates: { title?: string | null; agent_type?: "llm" | "elm" } = {};
  if (payload && "title" in payload) {
    const titleRaw = (payload as Record<string, unknown>).title;
    if (titleRaw != null && typeof titleRaw !== "string") {
      return NextResponse.json({ error: "Invalid 'title'" }, { status: 400 });
    }
    updates.title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : null;
  }
  if (payload && "agent_type" in payload) {
    const agentType = String((payload as Record<string, unknown>).agent_type || "").trim().toLowerCase();
    if (agentType !== "llm" && agentType !== "elm") {
      return NextResponse.json({ error: "Invalid 'agent_type'" }, { status: 400 });
    }
    updates.agent_type = agentType;
  }

  return NextResponse.json({ conversation: agentStore.updateConversation(conversationId, updates) });
}

export async function DELETE(request: NextRequest, context: Context) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();
  const { conversationId } = await context.params;
  const deleted = agentStore.deleteConversation(conversationId, identity.uid);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
