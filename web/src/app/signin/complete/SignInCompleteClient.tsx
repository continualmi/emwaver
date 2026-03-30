"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { beginGoogleRedirectSignIn, consumeGoogleRedirectResult, isFirebaseConfigured } from "@/lib/firebase";
import SignInShell from "../SignInShell";

function normalizeRedirect(raw: string | null) {
  if (!raw) return "/cloud";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/cloud";
}

export default function SignInCompleteClient() {
  const params = useSearchParams();
  const redirectPath = useMemo(() => normalizeRedirect(params.get("redirect")), [params]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Opening Google sign-in...");
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    void (async () => {
      if (!isFirebaseConfigured()) {
        setError("Google sign-in is not configured in this environment.");
        setStatus("Google sign-in is unavailable.");
        return;
      }

      try {
        setStatus("Opening Google sign-in...");
        const result = await consumeGoogleRedirectResult();

        if (!result?.user) {
          await beginGoogleRedirectSignIn();
          return;
        }

        setStatus("Completing your EMWaver session...");
        const idToken = await result.user.getIdToken();
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ idToken }),
        });
        const json = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(json?.error || "Unable to complete sign-in.");
        }

        setStatus("Redirecting back to EMWaver...");
        window.location.replace(redirectPath);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to complete sign-in.");
        setStatus("Google sign-in could not be completed.");
      }
    })();
  }, [redirectPath]);

  return (
    <SignInShell
      title="Continue with Continual"
      copy={status}
      redirectPath={redirectPath}
      error={error}
      actions={error ? (
        <>
          <Link
            href={`/signin?redirect=${encodeURIComponent(redirectPath)}`}
            className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-3 text-sm font-semibold text-[color:var(--paper)] transition hover:opacity-95"
          >
            Try again
          </Link>
          <Link
            href={redirectPath}
            className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
          >
            Cancel
          </Link>
        </>
      ) : null}
      footer={(
        <p>
          Google authentication happens in this tab only. Once it returns, EMWaver creates your local browser session and sends you back automatically.
        </p>
      )}
    />
  );
}
