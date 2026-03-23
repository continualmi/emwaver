import type { NextRequest } from "next/server";

import { getSessionUserFromRequest, type SessionUser } from "./session";

export type VerifiedIdentity = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  status?: string;
  identities?: SessionUser["identities"];
};

export function getVerifiedIdentityFromRequest(req: NextRequest): VerifiedIdentity | null {
  const user = getSessionUserFromRequest(req);
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.name ?? null,
    photoURL: user.picture ?? null,
    status: user.status,
    identities: user.identities,
  };
}
