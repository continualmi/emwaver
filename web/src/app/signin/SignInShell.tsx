"use client";

import Image from "next/image";

type SignInShellProps = {
  title: string;
  copy: string;
  redirectPath: string;
  error?: string | null;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  eyebrow?: string;
};

export default function SignInShell({
  title,
  copy,
  redirectPath,
  error = null,
  actions,
  footer,
  eyebrow = "Continual Account",
}: SignInShellProps) {
  return (
    <div className="emw-auth-shell">
      <div className="emw-auth-backdrop" aria-hidden="true" />
      <div className="emw-auth-card">
        <div className="emw-auth-brand">
          <div className="emw-auth-brand-stack">
            <div className="emw-auth-brand-logo">
              <Image src="/continuous-logo.png" alt="" width={40} height={40} className="h-full w-full object-contain" />
            </div>
            <div className="emw-auth-brand-logo">
              <Image src="/logo.png" alt="" width={40} height={40} className="h-full w-full object-cover" />
            </div>
          </div>
        </div>

        <div className="emw-auth-kicker">{eyebrow}</div>
        <h1 className="emw-auth-title">{title}</h1>
        <p className="emw-auth-copy">{copy}</p>

        <div className="emw-auth-return">
          <span className="emw-auth-return-label">Returning to</span>
          <strong>{redirectPath}</strong>
        </div>

        {error ? (
          <div className="emw-auth-error" role="alert">
            <strong>Sign-in failed</strong>
            <p>{error}</p>
          </div>
        ) : null}

        {actions ? <div className="emw-auth-actions">{actions}</div> : null}
        {footer ? <div className="emw-auth-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
