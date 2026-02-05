"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { EmwUiPreview } from "@/components/EmwUiPreview";
import { evalEmwUi } from "@/lib/emwUiRuntime";
import { firebaseAuth, googleProvider } from "@/lib/firebase";
import {
  deleteFile,
  downloadFileContent,
  listFiles,
  type CloudUserFile,
  uploadFile,
} from "@/lib/backend";

function isRaw(name: string) {
  return name.toLowerCase().endsWith(".raw");
}
function isTxt(name: string) {
  return name.toLowerCase().endsWith(".txt");
}
function isEmw(name: string) {
  return name.toLowerCase().endsWith(".emw");
}

function bytesToHexView(bytes: Uint8Array, limit = 256 * 1024) {
  const n = Math.min(bytes.length, limit);
  const lines: string[] = [];
  for (let offset = 0; offset < n; offset += 16) {
    const chunk = bytes.slice(offset, Math.min(offset + 16, n));
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    const ascii = Array.from(chunk)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(16 * 3 - 1, " ")}  |${ascii}|`);
  }
  if (bytes.length > limit) lines.push(`\n… truncated to ${limit} bytes (of ${bytes.length})`);
  return lines.join("\n");
}

export default function CloudPage() {
  const auth = useMemo(() => firebaseAuth(), []);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");
  const [files, setFiles] = useState<CloudUserFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewerText, setViewerText] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  async function refresh(token: string) {
    setError(null);
    const f = await listFiles(token);
    setFiles(f);
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      if (!u) {
        setUserEmail(null);
        setIdToken("");
        setFiles([]);
        setSelected(null);
        setViewerText("");
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      const tok = await u.getIdToken();
      setIdToken(tok);
      await refresh(tok);
    });
  }, [auth]);

  async function doSignIn() {
    setError(null);
    await signInWithPopup(auth, googleProvider());
  }

  async function doSignOut() {
    setError(null);
    await signOut(auth);
  }

  async function openFile(name: string) {
    if (!idToken) return;
    setIsBusy(true);
    setError(null);
    setSelected(name);
    try {
      const buf = await downloadFileContent(name, idToken);
      const bytes = new Uint8Array(buf);
      if (isRaw(name)) {
        setViewerText(bytesToHexView(bytes));
      } else {
        // try utf-8
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setViewerText(text);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveCurrent() {
    if (!idToken || !selected) return;
    if (isRaw(selected)) {
      setError("Editing .raw in-browser not supported yet (viewer only)");
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const bytes = new TextEncoder().encode(viewerText);
      const ct = isEmw(selected) || isTxt(selected) ? "text/plain" : "application/octet-stream";
      await uploadFile(selected, bytes, ct, Date.now(), idToken);
      await refresh(idToken);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  async function doDelete(name: string) {
    if (!idToken) return;
    if (!confirm(`Delete ${name}?`)) return;
    setIsBusy(true);
    setError(null);
    try {
      await deleteFile(name, idToken);
      setSelected(null);
      setViewerText("");
      await refresh(idToken);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  async function doUploadFromPicker(file: File) {
    if (!idToken) return;
    setIsBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const ct = file.type || (isTxt(file.name) || isEmw(file.name) ? "text/plain" : "application/octet-stream");
      await uploadFile(file.name, bytes, ct, Date.now(), idToken);
      await refresh(idToken);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 pt-10 pb-14">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Dashboard</h1>
            <div className="pt-1 text-sm text-[color:var(--ink-dim)]">Cloud file browser + editor</div>
          </div>

          {!userEmail ? (
            <button
              onClick={doSignIn}
              className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
            >
              Sign in with Google
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="text-sm text-[color:var(--ink-dim)]">{userEmail}</div>
              <button
                onClick={doSignOut}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Log out
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[340px_1fr]">
          <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Files</div>
              <button
                disabled={!idToken || isBusy}
                onClick={() => idToken && refresh(idToken)}
                className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-semibold text-[color:var(--ink-dim)]">Upload</label>
              <input
                type="file"
                disabled={!idToken || isBusy}
                className="mt-2 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-xs text-[color:var(--ink)] disabled:opacity-50"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void doUploadFromPicker(f);
                  e.currentTarget.value = "";
                }}
              />
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-[color:var(--line)]">
              {files.length === 0 ? (
                <div className="p-3 text-sm text-[color:var(--ink-dim)]">
                  No files indexed yet. First sync/upload will populate Postgres.
                </div>
              ) : (
                <ul className="divide-y divide-[color:var(--line)]">
                  {files.map((f) => (
                    <li key={f.name} className={selected === f.name ? "bg-[rgba(91,192,255,0.10)]" : ""}>
                      <div className="flex items-start justify-between gap-3 p-3">
                        <button
                          onClick={() => void openFile(f.name)}
                          className="flex-1 text-left"
                          disabled={!idToken || isBusy}
                        >
                          <div className="font-semibold text-[color:var(--ink)]">{f.name}</div>
                          <div className="pt-0.5 text-xs text-[color:var(--ink-dim)]">
                            {(f.size_bytes ?? 0).toLocaleString()} bytes
                            {typeof f.mtime_ms === "number" ? ` • ${new Date(f.mtime_ms).toLocaleString()}` : ""}
                          </div>
                        </button>
                        <button
                          disabled={!idToken || isBusy}
                          onClick={() => void doDelete(f.name)}
                          className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)] disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error ? <div className="mt-3 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
          </section>

          <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-[color:var(--ink)]">{selected ? selected : "Viewer"}</div>
              <button
                disabled={!selected || isBusy || !idToken}
                onClick={saveCurrent}
                className="rounded-lg bg-[color:var(--ink)] px-3 py-1.5 text-xs font-semibold text-[color:var(--paper)] disabled:opacity-50"
              >
                Save
              </button>
            </div>

            <textarea
              value={viewerText}
              onChange={(e) => {
                setViewerText(e.target.value);
                setUiError(null);
              }}
              readOnly={selected ? isRaw(selected) : true}
              className="mt-3 h-[calc(100vh-360px)] w-full rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-3 font-mono text-xs leading-5 text-[color:var(--ink)] outline-none"
            />

            {selected && isRaw(selected) ? (
              <div className="mt-2 text-xs text-[color:var(--ink-dim)]">.raw is viewer-only for now.</div>
            ) : null}

            {selected && isEmw(selected) ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[color:var(--ink)]">UI preview</div>
                  <button
                    type="button"
                    className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)]"
                    onClick={() => {
                      const r = evalEmwUi(viewerText);
                      setUiError(r.error || null);
                      // Force a re-render by setting viewerText to itself is unnecessary; preview uses eval inline below.
                    }}
                  >
                    Render
                  </button>
                </div>

                {uiError ? <div className="mt-2 whitespace-pre-wrap text-xs text-red-300">{uiError}</div> : null}

                <div className="mt-3 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                  {(() => {
                    const r = evalEmwUi(viewerText);
                    if (!r.root) {
                      return <div className="text-sm text-[color:var(--ink-dim)]">No UI.render(...) found.</div>;
                    }
                    return <EmwUiPreview root={r.root} />;
                  })()}
                </div>

                <div className="mt-2 text-xs text-[color:var(--ink-dim)]">
                  Preview mode: buttons are disabled and device APIs are stubbed.
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
