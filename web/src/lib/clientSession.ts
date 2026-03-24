"use client";

import { societySiteUrl } from "./societySite";

const CANONICAL_EMWAVER_APP_URL = "https://emwaver-web.azurewebsites.net";

function emwaverAppUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_EMWAVER_FRONTEND_URL_CLOUD || CANONICAL_EMWAVER_APP_URL;
  return value.trim().replace(/\/+$/, "");
}

export type ClientSessionUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  status: string;
};

export async function fetchSessionState(): Promise<{ user: ClientSessionUser | null; accessToken: string }> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (response.status === 401) {
    return { user: null, accessToken: "" };
  }
  if (!response.ok) {
    throw new Error("Failed to load session");
  }

  const json = (await response.json()) as {
    user?: ClientSessionUser;
    accessToken?: string;
  };

  return {
    user: json.user?.uid ? json.user : null,
    accessToken: typeof json.accessToken === "string" ? json.accessToken : "",
  };
}

export async function signOutSession() {
  await fetch("/api/auth/signout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: "{}",
  });
}

export function buildContinualSignInUrl(nextPath?: string) {
  const callback = new URL("/auth/callback", emwaverAppUrl());
  if (nextPath && nextPath.startsWith("/")) {
    callback.searchParams.set("next", nextPath);
  }

  const url = new URL("/api/auth/handoff", societySiteUrl());
  url.searchParams.set("product", "emwaver");
  url.searchParams.set("returnTo", callback.toString());
  return url.toString();
}

export function redirectToContinualSignIn(nextPath?: string) {
  window.location.assign(buildContinualSignInUrl(nextPath));
}

export function emwaverNativeHandoffUrl() {
  return new URL("/emwaver/handoff", societySiteUrl()).toString();
}
