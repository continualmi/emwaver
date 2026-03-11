import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { entitlementsStore } from "@/server/store/entitlements";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const now = Date.now();
  const row = entitlementsStore.get(identity.uid);

  let pro = false;
  let expiresAtMs: number | null = null;
  if (row.pro_active) {
    if (row.pro_expires_at_ms == null) {
      pro = true;
    } else {
      pro = row.pro_expires_at_ms > now;
      expiresAtMs = row.pro_expires_at_ms;
    }
  }

  return NextResponse.json({
    pro,
    expires_at_ms: expiresAtMs,
    features: {
      cloudHosts: pro,
      cloudFiles: pro,
      agent: pro,
    },
    server_time_ms: now,
  });
}
