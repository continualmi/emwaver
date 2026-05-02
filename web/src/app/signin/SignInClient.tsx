"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { EmwAuthGoogleButton } from "@/components/EmwAuthGoogleButton";
import { buildContinualSignInCompleteUrl } from "@/lib/clientSession";
import SignInShell from "./SignInShell";

function normalizeRedirect(raw: string | null) {
  if (!raw) return "/account";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/account";
}

export default function SignInClient() {
  const params = useSearchParams();
  const redirectPath = useMemo(() => normalizeRedirect(params.get("redirect")), [params]);
  const continueHref = useMemo(() => buildContinualSignInCompleteUrl(redirectPath), [redirectPath]);

  return (
    <SignInShell
      title="Continue with Continual"
      copy="Sign in to manage your Agent API key and optional Continual services. Local hardware scripts do not require sign-in."
      redirectPath={redirectPath}
      actions={(
        <>
          <EmwAuthGoogleButton
            className="w-full sm:min-w-[18rem]"
            onClick={() => window.location.assign(continueHref)}
          />
          <Link
            href={redirectPath}
            className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
          >
            Cancel
          </Link>
        </>
      )}
      footer={(
        <p>
          EMWaver keeps browser sign-in local to this app, then mints your EMWaver session and API-key management access on the web.
        </p>
      )}
    />
  );
}
