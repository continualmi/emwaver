import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { agentStore } from "@/server/store/agent";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();
  return NextResponse.json({ conversations: agentStore.listConversations(identity.uid) });
}

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = await request.json().catch(() => null);
  if (payload && typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const titleRaw = (payload as Record<string, unknown> | null)?.title;
  const agentTypeRaw = (payload as Record<string, unknown> | null)?.agent_type;
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : null;
  const agentType = agentTypeRaw == null ? "llm" : String(agentTypeRaw).trim().toLowerCase();
  if (agentType !== "llm" && agentType !== "elm") {
    return NextResponse.json({ error: "Invalid 'agent_type'" }, { status: 400 });
  }

  return NextResponse.json({
    conversation: agentStore.createConversation(identity.uid, title, agentType),
  });
}
