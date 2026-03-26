import "server-only";

import { createHmac } from "node:crypto";

import type { VerifiedIdentity } from "./auth";
import { getContinualAuthHandoffSecret, getContinualPlatformUrl } from "./env";

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function normalizeIdentity(identity: VerifiedIdentity) {
  return {
    uid: identity.uid,
    email: identity.email ?? "",
    name: identity.displayName ?? "",
    status: identity.status ?? "active",
    identities: identity.identities ?? [],
  };
}

function signPayload(identity: VerifiedIdentity, timestamp: string) {
  const normalized = normalizeIdentity(identity);
  return createHmac("sha256", getContinualAuthHandoffSecret())
    .update([
      "emwaver",
      normalized.uid,
      normalized.email,
      normalized.name,
      normalized.status,
      encode(JSON.stringify(normalized.identities)),
      timestamp,
    ].join("\n"))
    .digest("base64url");
}

function buildHeaders(identity: VerifiedIdentity) {
  const normalized = normalizeIdentity(identity);
  const timestamp = String(Date.now());
  return {
    "content-type": "application/json",
    "x-continual-product": "emwaver",
    "x-continual-user-id": normalized.uid,
    "x-continual-user-email": normalized.email,
    "x-continual-user-name": normalized.name,
    "x-continual-user-status": normalized.status,
    "x-continual-user-identities": encode(JSON.stringify(normalized.identities)),
    "x-continual-timestamp": timestamp,
    "x-continual-signature": signPayload(identity, timestamp),
  };
}

export async function fetchContinualPlatform(path: string, input: {
  method?: "GET" | "POST";
  identity: VerifiedIdentity;
  body?: Record<string, unknown>;
}) {
  return fetch(new URL(path, `${getContinualPlatformUrl()}/`).toString(), {
    method: input.method ?? "GET",
    headers: buildHeaders(input.identity),
    cache: "no-store",
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
}
