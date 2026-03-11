import { NextResponse, type NextRequest } from "next/server";

import { bearerToken, verifyIdToken, type VerifiedIdentity } from "./auth";

export async function requireIdentity(request: NextRequest): Promise<VerifiedIdentity | null> {
  const token = bearerToken(request.headers);
  if (!token) return null;
  return verifyIdToken(token);
}

export function unauthorizedJson() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
