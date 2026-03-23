import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/server/env";
import { unauthorizedJson, requireIdentity } from "@/server/http";
import { entitlementsStore } from "@/server/store/entitlements";

function isAdmin(uid: string, email: string | null | undefined) {
  if (env.provisioningAllowedUids.includes(uid)) return true;
  const normalizedEmail = (email || "").trim().toLowerCase();
  return Boolean(env.provisioningAllowedEmail && normalizedEmail === env.provisioningAllowedEmail);
}

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();
  if (!isAdmin(identity.uid, identity.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const uid = String((payload as Record<string, unknown>).uid || "").trim();
  if (!uid) {
    return NextResponse.json({ error: "Missing uid" }, { status: 400 });
  }

  const expiresAtRaw = (payload as Record<string, unknown>).expires_at_ms;
  let expires_at_ms: number | null = null;
  if (expiresAtRaw != null) {
    expires_at_ms = Number.parseInt(String(expiresAtRaw), 10);
    if (Number.isNaN(expires_at_ms)) {
      return NextResponse.json({ error: "Invalid expires_at_ms" }, { status: 400 });
    }
  }

  await entitlementsStore.set(uid, {
    pro_active: true,
    pro_expires_at_ms: expires_at_ms,
    updated_at_ms: Date.now(),
  });

  return NextResponse.json({ ok: true, uid, pro_active: true, expires_at_ms });
}
