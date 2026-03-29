"use client";

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
  const url = new URL("/signin", emwaverAppUrl());
  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    url.searchParams.set("redirect", nextPath);
  }
  return url.toString();
}

export function redirectToContinualSignIn(nextPath?: string) {
  window.location.assign(buildContinualSignInUrl(nextPath));
}

export function emwaverNativeHandoffUrl() {
  return new URL("/emwaver/handoff", emwaverAppUrl()).toString();
}
