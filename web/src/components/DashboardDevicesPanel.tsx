"use client";

import { useEffect, useState } from "react";

import { ModalPortal } from "@/components/ModalPortal";
import { listMyDevices, setDeviceLabel, type Device } from "@/lib/accountDevices";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type DashboardDevicesPanelProps = {
  idToken: string;
  signedIn: boolean;
};

export function DashboardDevicesPanel({ idToken, signedIn }: DashboardDevicesPanelProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function refreshDevices(token: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setDevices(await listMyDevices(token));
    } catch (error: unknown) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!signedIn || !idToken) {
      setDevices([]);
      setError(null);
      return;
    }
    void refreshDevices(idToken);
  }, [idToken, signedIn]);

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

  return (
    <>
      <section className="mb-4 shrink-0 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Activated devices</div>
              {signedIn ? (
                <span className="inline-flex items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ink-dim)]">
                  {devices.length}
                </span>
              ) : null}
            </div>
            <div className="pt-1 text-xs text-[color:var(--ink-dim)]">Boards tied to your EMWaver account</div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)]"
          >
            View list
          </button>
        </div>

        {!signedIn ? (
          <div className="pt-3 text-sm text-[color:var(--ink-dim)]">
            Sign in to see which boards are already activated on your account.
          </div>
        ) : (
          <div className="pt-3 text-sm text-[color:var(--ink-dim)]">
            Open the device list in a modal so the scripts workspace stays uncluttered.
          </div>
        )}

        {error ? <div className="mt-3 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
      </section>

      {modalOpen ? (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[color:var(--scrim)] px-4 py-8 md:py-14" onClick={() => setModalOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="activated-devices-title"
              className="w-full max-w-5xl rounded-[28px] border border-[color:var(--line)] bg-[color:var(--glass-heavy)] p-5 shadow-[0_32px_90px_var(--shadow-heavy)] backdrop-blur md:p-7"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--ink-dim)]">Dashboard</div>
                  <h3 id="activated-devices-title" className="pt-2 text-xl font-semibold tracking-tight text-[color:var(--ink)]">
                    Activated devices
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {signedIn ? (
                    <button
                      type="button"
                      onClick={() => void refreshDevices(idToken)}
                      disabled={busy}
                      className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] disabled:opacity-50"
                    >
                      Refresh
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)]"
                  >
                    Close
                  </button>
                </div>
              </div>

              {!signedIn ? (
                <div className="text-sm text-[color:var(--ink-dim)]">
                  Sign in to see which boards are already activated on your account.
                </div>
              ) : devices.length === 0 ? (
                <div className="text-sm text-[color:var(--ink-dim)]">
                  No activated devices yet.
                  <div className="pt-2 text-xs">Boards you activate in the apps will appear here.</div>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {devices.map((device) => (
                    <div
                      key={`${device.board_type}:${device.hardware_uid}`}
                      className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-4"
                    >
                      <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Board type</div>
                      <div className="mt-1 break-all font-mono text-xs text-[color:var(--ink)]">{device.board_type}</div>
                      <div className="mt-3 text-xs font-semibold text-[color:var(--ink-dim)]">Hardware UID</div>
                      <div className="mt-1 break-all font-mono text-xs text-[color:var(--ink)]">{device.hardware_uid}</div>
                      <div className="mt-3 text-xs font-semibold text-[color:var(--ink-dim)]">Label</div>
                      <input
                        defaultValue={device.label || ""}
                        placeholder="e.g. Lab board"
                        className="mt-1 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--ink)]"
                        onBlur={(event) => {
                          const next = String(event.target.value || "").trim();
                          void (async () => {
                            try {
                              await setDeviceLabel(idToken, device.board_type, device.hardware_uid, next);
                              await refreshDevices(idToken);
                            } catch (error: unknown) {
                              setError(errorMessage(error));
                            }
                          })();
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {error ? <div className="mt-4 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
