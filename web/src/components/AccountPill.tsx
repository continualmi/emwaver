"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";

import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";
import { AccountPanel } from "@/components/AccountPanel";
import { ModalPortal } from "@/components/ModalPortal";

function displayNameForUser(user: User | null) {
  if (!user) return "Account";
  const name = user.displayName?.trim();
  if (name) return name;
  return user.email?.split("@")[0] || "Account";
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="h-4 w-4">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.18-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18a8.77 8.77 0 0 0 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC04" d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.6.1-1.18.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.28 0 2.43.44 3.33 1.3l2.5-2.5C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function UserAvatar({ user }: { user: User | null }) {
  const photoUrl = user?.photoURL?.trim();
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="h-6 w-6 rounded-full object-cover" src={photoUrl} alt="" referrerPolicy="no-referrer" />;
  }
  if (user) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--aqua-tint-2)] text-[11px] font-semibold text-[color:var(--aqua)]">
        {displayNameForUser(user).slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow-sm">
      <GoogleLogo />
    </span>
  );
}

type AccountPillProps = {
  variant?: "pill" | "button";
  label?: string;
  className?: string;
};

export function AccountPill({ variant = "pill", label, className = "" }: AccountPillProps) {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, [auth]);

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modalOpen]);

  async function handleLogin() {
    if (!auth) return;
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider());
      setMenuOpen(false);
      setModalOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const triggerLabel = label || (authReady ? displayNameForUser(user) : "Account");
  const triggerClassName =
    variant === "button"
      ? "inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
      : "inline-flex items-center gap-1.5 rounded-full border border-[color:var(--line)] bg-[color:var(--glass-heavy)] px-2 py-1 text-[13px] font-medium text-[color:var(--ink)] shadow-sm transition hover:bg-[color:var(--surface)]";

  return (
    <>
      <div ref={rootRef} className={`relative ${className}`.trim()}>
        <button
          type="button"
          className={triggerClassName}
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <span className="shrink-0">
            <UserAvatar user={user} />
          </span>
          <span>{triggerLabel}</span>
        </button>

        {menuOpen ? (
          <div className="absolute right-0 z-50 mt-2 min-w-56 rounded-2xl border border-[color:var(--line)] bg-[color:var(--glass-heavy)] p-2 shadow-[0_24px_60px_var(--shadow-heavy)] backdrop-blur">
            <button
              type="button"
              className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface)]"
              onClick={() => {
                setMenuOpen(false);
                setModalOpen(true);
              }}
            >
              Account settings
            </button>
            {!user && authReady && auth ? (
              <button
                type="button"
                className="mt-1 flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-[color:var(--ink-dim)] hover:bg-[color:var(--surface)]"
                onClick={() => void handleLogin()}
                disabled={busy}
              >
                {busy ? "Signing in..." : "Continue with Google"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[color:var(--scrim)] px-4 py-8 md:py-14" onClick={() => setModalOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-modal-title"
              className="w-full max-w-4xl rounded-[28px] border border-[color:var(--line)] bg-[color:var(--glass-heavy)] p-5 shadow-[0_32px_90px_var(--shadow-heavy)] backdrop-blur md:p-7"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--ink-dim)]">Account</div>
                  <h3 id="account-modal-title" className="pt-2 text-xl font-semibold tracking-tight text-[color:var(--ink)]">
                    Account settings
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
                >
                  Close
                </button>
              </div>
              <AccountPanel />
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
