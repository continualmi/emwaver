import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { ordersStore } from "@/server/store/orders";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = await request.json().catch(() => null);
  const sessionId = String((payload as Record<string, unknown> | null)?.session_id || "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "missing_session_id" }, { status: 400 });
  }

  const result = await ordersStore.claim(sessionId, identity.uid);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "already_claimed" ? 409 : 404 });
  }

  return NextResponse.json({ order: result.order });
}
