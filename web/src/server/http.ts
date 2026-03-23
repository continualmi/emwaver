import { NextResponse, type NextRequest } from "next/server";

import { getVerifiedIdentityFromRequest, type VerifiedIdentity } from "./auth";

export async function requireIdentity(request: NextRequest): Promise<VerifiedIdentity | null> {
  return getVerifiedIdentityFromRequest(request);
}

export function unauthorizedJson() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
