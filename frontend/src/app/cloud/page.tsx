"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
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
    <div style={{ padding: 24, display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Cloud Files</h1>

        {!idToken ? (
          <button onClick={doSignIn}>Sign in with Google</button>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div style={{ color: "#666" }}>{userEmail}</div>
            <button onClick={doSignOut}>Sign out</button>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}>Upload</label>
          <input
            type="file"
            disabled={!idToken || isBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doUploadFromPicker(f);
              e.currentTarget.value = "";
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button disabled={!idToken || isBusy} onClick={() => idToken && refresh(idToken)}>
            Refresh
          </button>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
          {files.length === 0 ? (
            <div style={{ padding: 12, color: "#666" }}>No files indexed yet. First sync/upload will populate Postgres.</div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {files.map((f) => (
                <li
                  key={f.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "10px 12px",
                    borderBottom: "1px solid #f2f2f2",
                    background: selected === f.name ? "#f7f7ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div onClick={() => void openFile(f.name)} style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {(f.size_bytes ?? 0).toLocaleString()} bytes
                      {typeof f.mtime_ms === "number" ? ` • mtime ${new Date(f.mtime_ms).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <button disabled={!idToken || isBusy} onClick={() => void doDelete(f.name)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? <div style={{ marginTop: 12, color: "#b00020", whiteSpace: "pre-wrap" }}>{error}</div> : null}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>{selected ? selected : "Viewer"}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={!selected || isBusy || !idToken} onClick={saveCurrent}>
              Save
            </button>
          </div>
        </div>
        <textarea
          value={viewerText}
          onChange={(e) => setViewerText(e.target.value)}
          readOnly={selected ? isRaw(selected) : true}
          style={{
            width: "100%",
            height: "calc(100vh - 120px)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontSize: 12,
            lineHeight: 1.4,
            padding: 12,
            border: "1px solid #eee",
            borderRadius: 8,
          }}
        />
        {selected && isRaw(selected) ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>.raw is viewer-only for now.</div>
        ) : null}
      </div>
    </div>
  );
}
