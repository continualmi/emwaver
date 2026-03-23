import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getContinualAuthHandoffSecret } from "./env";
import type { SessionIdentity, SessionUser } from "./session";

type HandoffPayload = {
  iss: "society";
  aud: "emwaver";
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  status: string;
  identities: SessionIdentity[];
  iat: number;
  exp: number;
};

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string) {
  return createHmac("sha256", getContinualAuthHandoffSecret()).update(encodedPayload).digest("base64url");
}

export function verifyContinualHandoffToken(token: string): SessionUser | null {
  const [encodedPayload, encodedSignature] = token.split(".", 2);
  if (!encodedPayload || !encodedSignature) return null;

  const expected = Buffer.from(sign(encodedPayload));
  const actual = Buffer.from(encodedSignature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(decode(encodedPayload)) as HandoffPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== "society" || payload.aud !== "emwaver" || payload.exp <= now) return null;

    return {
      uid: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      status: payload.status,
      identities: Array.isArray(payload.identities) ? payload.identities : [],
    };
  } catch {
    return null;
  }
}
