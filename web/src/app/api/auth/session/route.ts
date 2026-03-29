import { NextRequest, NextResponse } from "next/server";

import { getVerifiedIdentityFromRequest } from "@/server/auth";
import { ensurePlatformUser } from "@/server/platformCore";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { createSessionToken } from "@/server/session";
import { setSessionCookie } from "@/server/session";

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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "idToken is required" }, { status: 400 });
  }

  const verifiedUser = await verifyFirebaseIdToken(idToken);
  if (!verifiedUser) {
    return NextResponse.json({ error: "Invalid Firebase ID token" }, { status: 401 });
  }

  const platformUser = await ensurePlatformUser({
    firebaseUid: verifiedUser.uid,
    email: verifiedUser.email,
    displayName: verifiedUser.displayName,
  });

  const accessToken = createSessionToken({
    uid: platformUser.id,
    email: platformUser.email ?? verifiedUser.email ?? null,
    name: platformUser.display_name ?? verifiedUser.displayName ?? null,
    picture: verifiedUser.picture ?? null,
    status: "active",
    identities: [
      {
        provider: "continual",
        providerUserId: platformUser.id,
        email: platformUser.email ?? verifiedUser.email ?? null,
        displayName: platformUser.display_name ?? verifiedUser.displayName ?? null,
      },
      {
        provider: "firebase",
        providerUserId: verifiedUser.uid,
        email: verifiedUser.email ?? null,
        displayName: verifiedUser.displayName ?? null,
      },
    ],
  });

  const response = NextResponse.json({
    user: {
      uid: platformUser.id,
      email: platformUser.email ?? verifiedUser.email ?? null,
      name: platformUser.display_name ?? verifiedUser.displayName ?? null,
      picture: verifiedUser.picture ?? null,
      status: "active",
    },
    accessToken,
  });
  setSessionCookie(response.cookies, accessToken);
  return response;
}
