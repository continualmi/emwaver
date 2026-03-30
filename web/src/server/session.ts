import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";

import { resolveApiKeySessionUser } from "./apiKeys";
import { getEmwaverAppUrl, getEmwaverSessionMaxAgeSeconds, getEmwaverSessionSecret } from "./env";

export const EMWAVER_SESSION_COOKIE_NAME = "emwaver_session";

export type SessionIdentity = {
  provider: string;
  providerUserId: string;
  email: string | null;
  displayName: string | null;
};

export type SessionUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  status: string;
  identities: SessionIdentity[];
};

type SessionPayload = {
  iss: "emwaver";
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  status: string;
  identities: SessionIdentity[];
  iat: number;
  exp: number;
};

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string) {
  return createHmac("sha256", getEmwaverSessionSecret()).update(encodedPayload).digest("base64url");
}

function isSecureCookie() {
  if (process.env.NODE_ENV === "production") return true;
  return getEmwaverAppUrl().startsWith("https://");
}

function getCookieDomain() {
  if (process.env.NODE_ENV !== "production") return undefined;
  return new URL(getEmwaverAppUrl()).hostname;
}

export function createSessionToken(user: SessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iss: "emwaver",
    sub: user.uid,
    email: user.email,
    name: user.name,
    picture: user.picture,
    status: user.status,
    identities: user.identities,
    iat: now,
    exp: now + getEmwaverSessionMaxAgeSeconds(),
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  const [encodedPayload, encodedSignature] = token.split(".", 2);
  if (!encodedPayload || !encodedSignature) return null;

  const expected = Buffer.from(sign(encodedPayload));
  const actual = Buffer.from(encodedSignature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(decode(encodedPayload)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== "emwaver" || payload.exp <= now) return null;

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

export function bearerToken(headers: Headers): string | null {
  const raw = (headers.get("authorization") || "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice("bearer ".length).trim();
  return token || null;
}

export async function getBearerUserFromToken(token: string): Promise<SessionUser | null> {
  const sessionUser = verifySessionToken(token);
  if (sessionUser) return sessionUser;

  const apiKeyUser = await resolveApiKeySessionUser(token);
  if (!apiKeyUser) return null;
  return apiKeyUser;
}

export async function getSessionUserFromRequest(req: NextRequest) {
  const bearer = bearerToken(req.headers);
  if (bearer) {
    return getBearerUserFromToken(bearer);
  }

  const cookieToken = req.cookies.get(EMWAVER_SESSION_COOKIE_NAME)?.value?.trim();
  if (!cookieToken) return null;
  return verifySessionToken(cookieToken);
}

export function setSessionCookie(cookieStore: ResponseCookies, token: string) {
  cookieStore.set({
    name: EMWAVER_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(),
    path: "/",
    domain: getCookieDomain(),
    expires: new Date(Date.now() + getEmwaverSessionMaxAgeSeconds() * 1000),
  });
}

export function clearSessionCookie(cookieStore: ResponseCookies) {
  cookieStore.set({
    name: EMWAVER_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(),
    path: "/",
    domain: getCookieDomain(),
    expires: new Date(0),
  });
}
