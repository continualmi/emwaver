/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { safeInvoke } from "../../../utils/tauri";

type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  ts: number;
};

type LlmMessage = {
  role: string;
  content: string;
};

type LlmChatResponse = {
  content: string;
  model: string;
};

const SYSTEM_PROMPT: LlmMessage = {
  role: "system",
  content:
    "You are the EMWaver in-app agent. You have no tools yet. Keep responses concise and practical for hardware exploration.",
};

export default function AgentChatPane({
  storageKey,
}: {
  storageKey: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      setMessages([]);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ChatMessage[];
      if (Array.isArray(parsed)) {
        setMessages(
          parsed
            .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map((m) => ({ ...m, ts: typeof m.ts === "number" ? m.ts : Date.now() })),
        );
      }
    } catch {
      setMessages([]);
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isSending]);

  const requestMessages = useMemo(() => {
    const chat: LlmMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
    return [SYSTEM_PROMPT, ...chat];
  }, [messages]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content) return;
    if (isSending) return;

    setError(null);
    setIsSending(true);

    const userMsg: ChatMessage = { role: "user", content, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");

    try {
      const res = await safeInvoke<LlmChatResponse>(
        "llm_chat",
        {
          payload: {
            messages: [...requestMessages, { role: "user", content }],
            model: "x-ai/grok-4.1-fast",
          },
        },
        { throwOnError: true },
      );

      if (!res) {
        throw new Error("LLM unavailable (not running in desktop backend)");
      }

      const assistant: ChatMessage = {
        role: "assistant",
        content: res.content,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, assistant]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsSending(false);
      window.setTimeout(() => draftRef.current?.focus(), 0);
    }
  }, [draft, isSending, requestMessages]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-900 px-3 py-2">
        <div className="text-xs font-semibold text-slate-200">Agent</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setError(null);
              if (typeof window !== "undefined") {
                window.localStorage.removeItem(storageKey);
              }
            }}
            className="rounded px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-900/60 hover:text-slate-200"
            title="Clear chat"
          >
            Clear
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="rounded border border-slate-900 bg-slate-950 p-3 text-xs text-slate-500">
            Ask anything about EMWaver scripts. Tools aren’t wired yet.
          </div>
        ) : null}

        <div className="space-y-3">
          {messages.map((m, idx) => (
            <div key={`${m.ts}-${idx}`} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[92%] rounded-2xl bg-slate-900/70 px-3 py-2 text-xs leading-relaxed text-slate-100 ring-1 ring-inset ring-slate-800"
                    : "max-w-[92%] rounded-2xl bg-slate-950 px-3 py-2 text-xs leading-relaxed text-slate-200 ring-1 ring-inset ring-slate-900"
                }
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <div className="border-t border-slate-900 bg-slate-950 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="border-t border-slate-900 bg-slate-950 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message…"
            className="min-h-[44px] max-h-40 flex-1 resize-y rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-slate-700 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={isSending || !draft.trim()}
            className={
              isSending || !draft.trim()
                ? "h-[44px] rounded-xl border border-slate-900 bg-slate-950 px-3 text-xs font-semibold text-slate-600"
                : "h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 text-xs font-semibold text-slate-200 hover:border-slate-700 hover:bg-slate-900"
            }
          >
            {isSending ? "Sending…" : "Send"}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-slate-600">Enter to send, Shift+Enter for newline</div>
      </div>
    </div>
  );
}
