"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import {
  agentChat,
  createAgentConversation,
  listAgentConversations,
  listAgentMessages,
  type AgentConversation,
  type AgentMessage,
} from "@/lib/backend";
import { fetchSessionState, redirectToContinualSignIn, signOutSession } from "@/lib/clientSession";

function formatTitle(c: AgentConversation) {
  const t = (c.title || "").trim();
  if (t) return t;
  const d = new Date(c.created_at_ms);
  return `Chat ${d.toISOString().slice(0, 10)}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === "string" ? candidate.code : "";
    const message = typeof candidate.message === "string" ? candidate.message : String(error);
    return code ? `${code}: ${message}` : message;
  }
  return String(error);
}

export default function AgentChatPage() {
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

  const refreshConversations = useCallback(async (tok: string) => {
    const cs = await listAgentConversations(tok);
    setConversations(cs);
    return cs;
  }, []);

  const openConversation = useCallback(async (tok: string, id: string) => {
    setError(null);
    setSelectedId(id);
    const ms = await listAgentMessages(tok, id);
    setMessages(ms);
    setTimeout(scrollToBottom, 0);
  }, []);

  useEffect(() => {
    void (async () => {
      setError(null);
      const session = await fetchSessionState();
      if (!session.user) {
        setUserEmail(null);
        setIdToken("");
        setConversations([]);
        setSelectedId(null);
        setMessages([]);
        setDraft("");
        return;
      }

      setUserEmail(session.user.email || session.user.name || "Signed in");
      const tok = session.accessToken;
      setIdToken(tok);

      const cs = await refreshConversations(tok);
      if (cs.length > 0) {
        await openConversation(tok, cs[0].id);
      } else {
        const c = await createAgentConversation(tok);
        setConversations([c]);
        await openConversation(tok, c.id);
      }
    })();
  }, [openConversation, refreshConversations]);

  async function doSignIn() {
    redirectToContinualSignIn("/cloud/agent");
  }

  async function doSignOut() {
    setError(null);
    await signOutSession();
    setUserEmail(null);
    setIdToken("");
    setConversations([]);
    setSelectedId(null);
    setMessages([]);
    setDraft("");
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
    } catch (error: unknown) {
      setError(errorMessage(error));
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
      const result = await agentChat(idToken, selectedId, text);
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === assistantMsg.id);
        if (idx !== -1) next[idx] = result.message;
        return next;
      });
      setTimeout(scrollToBottom, 0);

      await refreshConversations(idToken);
    } catch (error: unknown) {
      setError(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="w-full overflow-y-auto px-5 pt-10 pb-14">
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
              Sign in with Continual
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="text-sm text-[color:var(--ink-dim)]">{userEmail}</div>
              <Link
                href="/cloud"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Gateway
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
                    <li key={c.id} className={selectedId === c.id ? "bg-[color:var(--sky-tint-2)]" : ""}>
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
              className="h-[calc(100vh-340px)] overflow-y-auto rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-3"
            >
              {messages.length === 0 ? (
                <div className="text-sm text-[color:var(--ink-dim)]">No messages yet.</div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-xl border border-[color:var(--line)] bg-[color:var(--glass)] p-3">
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
                className="min-h-12 flex-1 resize-y rounded-xl border border-[color:var(--line)] bg-[color:var(--image-well)] p-3 text-sm text-[color:var(--ink)] outline-none disabled:opacity-50"
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

    </div>
  );
}
