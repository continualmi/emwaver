"use client";

import { useEffect, useRef, useState } from "react";

import { EmwAuthGoogleButton } from "@/components/EmwAuthGoogleButton";
import { GoogleMark } from "@/components/GoogleMark";
import { fetchSessionState, redirectToContinualSignIn } from "@/lib/clientSession";
import { AccountPanel } from "@/components/AccountPanel";
import { ModalPortal } from "@/components/ModalPortal";

type SessionUser = {
  email: string | null;
  name: string | null;
  picture: string | null;
};

function displayNameForUser(user: SessionUser | null) {
  if (!user) return "Account";
  const name = user.name?.trim();
  if (name) return name;
  return user.email?.split("@")[0] || "Account";
}

function UserAvatar({ user }: { user: SessionUser | null }) {
  const photoUrl = user?.picture?.trim();
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
      <GoogleMark />
    </span>
  );
}

type AccountPillProps = {
  variant?: "pill" | "button";
  label?: string;
  className?: string;
};

export function AccountPill({ variant = "pill", label, className = "" }: AccountPillProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const session = await fetchSessionState();
      if (session.user) {
        setUser({
          email: session.user.email,
          name: session.user.name,
          picture: session.user.picture,
        });
      }
      setAuthReady(true);
    })();
  }, []);

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
    setBusy(true);
    try {
      redirectToContinualSignIn("/cloud");
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
            {!user && authReady ? (
              <div className="mt-2">
                <EmwAuthGoogleButton
                  busy={busy}
                  label="Continue with Google"
                  busyLabel="Opening Google..."
                  className="w-full text-sm"
                  onClick={() => void handleLogin()}
                />
              </div>
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
