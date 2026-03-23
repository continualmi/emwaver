import { NextRequest, NextResponse } from "next/server";

import { verifyContinualHandoffToken } from "@/server/continualHandoff";
import { createSessionToken, setSessionCookie } from "@/server/session";

function normalizeNextPath(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/cloud";
  return raw;
}

export async function GET(req: NextRequest) {
  const handoff = (req.nextUrl.searchParams.get("handoff") || "").trim();
  const user = verifyContinualHandoffToken(handoff);
  if (!user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const response = NextResponse.redirect(new URL(normalizeNextPath(req.nextUrl.searchParams.get("next")), req.nextUrl.origin));
  setSessionCookie(response.cookies, createSessionToken(user));
  return response;
}
