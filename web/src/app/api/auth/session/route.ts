import { NextRequest, NextResponse } from "next/server";

import { getVerifiedIdentityFromRequest } from "@/server/auth";
import { createSessionToken } from "@/server/session";

export async function GET(request: NextRequest) {
  const user = getVerifiedIdentityFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const accessToken = createSessionToken({
    uid: user.uid,
    email: user.email ?? null,
    name: user.displayName ?? null,
    picture: user.photoURL ?? null,
    status: user.status || "active",
    identities: user.identities ?? [],
  });

  return NextResponse.json({
    user: {
      uid: user.uid,
      email: user.email ?? null,
      name: user.displayName ?? null,
      picture: user.photoURL ?? null,
      status: user.status || "active",
    },
    accessToken,
  });
}
