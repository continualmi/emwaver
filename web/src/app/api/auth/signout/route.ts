import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/server/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response.cookies);
  return response;
}
