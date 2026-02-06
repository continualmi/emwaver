"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";
import {
  agentChatStream,
  createAgentConversation,
  listAgentConversations,
  listAgentMessages,
  type AgentConversation,
  type AgentMessage,
} from "@/lib/backend";

function formatTitle(c: AgentConversation) {
  const t = (c.title || "").trim();
  if (t) return t;
  const d = new Date(c.created_at_ms);
  return `Chat ${d.toISOString().slice(0, 10)}`;
}

export default function AgentChatPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");

  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  const [draft, setDraft] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  async function refreshConversations(tok: string) {
    const cs = await listAgentConversations(tok);
    setConversations(cs);
    return cs;
  }

  async function openConversation(tok: string, id: string) {
    setError(null);
    setSelectedId(id);
    const ms = await listAgentMessages(tok, id);
    setMessages(ms);
    setTimeout(scrollToBottom, 0);
  }

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      if (!u) {
        setUserEmail(null);
        setIdToken("");
        setConversations([]);
        setSelectedId(null);
        setMessages([]);
        setDraft("");
        return;
      }

      setUserEmail(u.email || u.displayName || "Signed in");
      const tok = await u.getIdToken();
      setIdToken(tok);

      const cs = await refreshConversations(tok);
      if (cs.length > 0) {
        await openConversation(tok, cs[0].id);
      } else {
        const c = await createAgentConversation(tok);
        setConversations([c]);
        await openConversation(tok, c.id);
      }
    });
  }, [auth]);

  async function doSignIn() {
    setError(null);
    if (!auth) {
      setError(
        "Firebase env is missing. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_APP_ID"
      );
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider());
    } catch (e: any) {
      const code = e?.code ? String(e.code) : "";
      const msg = e?.message ? String(e.message) : String(e);
      setError(code ? `${code}: ${msg}` : msg);
    }
  }

  async function doSignOut() {
    setError(null);
    if (!auth) return;
    await signOut(auth);
  }

  async function newChat() {
    if (!idToken) return;
    setIsBusy(true);
    setError(null);
    try {
      const c = await createAgentConversation(idToken);
      const cs = [c, ...conversations];
      setConversations(cs);
      await openConversation(idToken, c.id);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  async function send() {
    if (!idToken || !selectedId) return;
    const text = draft.trim();
    if (!text) return;

    setDraft("");
    setIsBusy(true);
    setError(null);

    // optimistic UI: add user msg + placeholder assistant msg
    const userMsg: AgentMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: text,
      created_at_ms: Date.now(),
    };
    const assistantMsg: AgentMessage = {
      id: `local-asst-${Date.now()}`,
      role: "assistant",
      content: "",
      created_at_ms: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setTimeout(scrollToBottom, 0);

    try {
      let accum = "";
      for await (const ev of agentChatStream(idToken, selectedId, text)) {
        if (ev.type === "delta") {
          accum += ev.text;
          setMessages((prev) => {
            const next = [...prev];
            const idx = next.findIndex((m) => m.id === assistantMsg.id);
            if (idx !== -1) next[idx] = { ...next[idx], content: accum };
            return next;
          });
          setTimeout(scrollToBottom, 0);
        } else if (ev.type === "done") {
          // replace placeholder with real persisted message id/timestamp
          setMessages((prev) => {
            const next = [...prev];
            const idx = next.findIndex((m) => m.id === assistantMsg.id);
            if (idx !== -1) next[idx] = ev.message;
            return next;
          });
          break;
        } else if (ev.type === "error") {
          setError(ev.error);
          break;
        }
      }

      await refreshConversations(idToken);
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
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Agent</h1>
            <div className="pt-1 text-sm text-[color:var(--ink-dim)]">
              User ↔ Assistant chat (stored per account in Postgres)
            </div>
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
              <Link
                href="/cloud"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Dashboard
              </Link>
              <button
                onClick={doSignOut}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Log out
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <aside className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Conversations</div>
              <button
                disabled={!idToken || isBusy}
                onClick={() => void newChat()}
                className="rounded-lg bg-[color:var(--ink)] px-3 py-1.5 text-xs font-semibold text-[color:var(--paper)] disabled:opacity-50"
              >
                New
              </button>
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--line)]">
              {conversations.length === 0 ? (
                <div className="p-3 text-sm text-[color:var(--ink-dim)]">No conversations yet.</div>
              ) : (
                <ul className="divide-y divide-[color:var(--line)]">
                  {conversations.map((c) => (
                    <li key={c.id} className={selectedId === c.id ? "bg-[rgba(91,192,255,0.10)]" : ""}>
                      <button
                        type="button"
                        disabled={!idToken || isBusy}
                        onClick={() => idToken && void openConversation(idToken, c.id)}
                        className="w-full p-3 text-left"
                      >
                        <div className="font-semibold text-[color:var(--ink)]">{formatTitle(c)}</div>
                        <div className="pt-0.5 text-xs text-[color:var(--ink-dim)]">
                          {new Date(c.updated_at_ms).toLocaleString()}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error ? <div className="mt-3 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
          </aside>

          <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div
              ref={scrollRef}
              className="h-[calc(100vh-340px)] overflow-y-auto rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] p-3"
            >
              {messages.length === 0 ? (
                <div className="text-sm text-[color:var(--ink-dim)]">No messages yet.</div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-3">
                      <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{m.role}</div>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-[color:var(--ink)]">{m.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-end gap-2">
              <textarea
                value={draft}
                disabled={!idToken || !selectedId || isBusy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={!idToken ? "Sign in to chat" : "Message…"}
                className="min-h-12 flex-1 resize-y rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-3 text-sm text-[color:var(--ink)] outline-none disabled:opacity-50"
              />
              <button
                disabled={!idToken || !selectedId || isBusy || !draft.trim()}
                onClick={() => void send()}
                className="h-12 rounded-xl bg-[color:var(--ink)] px-4 text-sm font-semibold text-[color:var(--paper)] disabled:opacity-50"
              >
                Send
              </button>
            </div>

            <div className="mt-2 text-xs text-[color:var(--ink-dim)]">
              Tip: Enter to send • Shift+Enter for newline
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
