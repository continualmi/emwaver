import { NextRequest, NextResponse } from "next/server";

function normalizeNextPath(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/account";
  return raw;
}

export async function GET(req: NextRequest) {
  const redirectPath = normalizeNextPath(req.nextUrl.searchParams.get("next"));
  const signInUrl = new URL("/signin", req.nextUrl.origin);
  signInUrl.searchParams.set("redirect", redirectPath);
  return NextResponse.redirect(signInUrl);
}
