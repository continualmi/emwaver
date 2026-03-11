import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { hostSessionsStore } from "@/server/store/hostSessions";

function optString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const hostSessionId = optString((payload as Record<string, unknown>).host_session_id) || optString((payload as Record<string, unknown>).id);
  if (!hostSessionId) {
    return NextResponse.json({ error: "Missing 'host_session_id'" }, { status: 400 });
  }

  const capabilities = (payload as Record<string, unknown>).capabilities;
  const status = (payload as Record<string, unknown>).status;
  if (capabilities != null && typeof capabilities !== "object") {
    return NextResponse.json({ error: "Invalid 'capabilities'" }, { status: 400 });
  }
  if (status != null && typeof status !== "object") {
    return NextResponse.json({ error: "Invalid 'status'" }, { status: 400 });
  }

  const result = hostSessionsStore.upsert(identity.uid, {
    host_session_id: hostSessionId,
    platform: optString((payload as Record<string, unknown>).platform, "unknown"),
    device_name: optString((payload as Record<string, unknown>).device_name),
    app_version: optString((payload as Record<string, unknown>).app_version),
    capabilities: (capabilities as Record<string, unknown>) || {},
    status: (status as Record<string, unknown>) || {},
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, created: result.created, server_time_ms: result.server_time_ms });
}
