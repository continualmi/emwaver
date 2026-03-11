import { NextResponse, type NextRequest } from "next/server";

import { getFirebaseAdminApp } from "@/server/auth";
import { unauthorizedJson, requireIdentity } from "@/server/http";
import { authHandoffStore } from "@/server/store/authHandoff";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  try {
    getFirebaseAdminApp();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  return NextResponse.json(authHandoffStore.issue(identity.uid));
}
