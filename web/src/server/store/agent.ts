import { randomUUID } from "node:crypto";

import { readCollection, writeCollection } from "./jsonStore";

export type AgentConversationRecord = {
  id: string;
  firebase_uid: string;
  title: string | null;
  agent_type: "llm" | "elm";
  created_at_ms: number;
  updated_at_ms: number;
};

export type AgentMessageRecord = {
  id: string;
  conversation_id: string;
  firebase_uid: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at_ms: number;
};

function nowMs() {
  return Date.now();
}

class AgentStore {
  private conversations = new Map<string, AgentConversationRecord>(
    Object.entries(readCollection<Record<string, AgentConversationRecord>>("agent-conversations", {})),
  );
  private messages = new Map<string, AgentMessageRecord>(
    Object.entries(readCollection<Record<string, AgentMessageRecord>>("agent-messages", {})),
  );

  private persist() {
    writeCollection("agent-conversations", Object.fromEntries(this.conversations.entries()));
    writeCollection("agent-messages", Object.fromEntries(this.messages.entries()));
  }

  listConversations(firebaseUid: string) {
    return [...this.conversations.values()]
      .filter((row) => row.firebase_uid === firebaseUid)
      .sort((a, b) => b.updated_at_ms - a.updated_at_ms);
  }

  createConversation(firebaseUid: string, title: string | null, agentType: "llm" | "elm") {
    const now = nowMs();
    const conversation: AgentConversationRecord = {
      id: randomUUID(),
      firebase_uid: firebaseUid,
      title,
      agent_type: agentType,
      created_at_ms: now,
      updated_at_ms: now,
    };
    this.conversations.set(conversation.id, conversation);
    this.persist();
    return conversation;
  }

  getConversation(id: string) {
    return this.conversations.get(id) || null;
  }

  updateConversation(id: string, updates: Partial<Pick<AgentConversationRecord, "title" | "agent_type">>) {
    const conversation = this.conversations.get(id);
    if (!conversation) return null;
    if ("title" in updates) conversation.title = updates.title ?? null;
    if (updates.agent_type) conversation.agent_type = updates.agent_type;
    conversation.updated_at_ms = nowMs();
    this.conversations.set(id, conversation);
    this.persist();
    return conversation;
  }

  deleteConversation(id: string, firebaseUid: string) {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.firebase_uid !== firebaseUid) {
      return false;
    }
    this.conversations.delete(id);
    for (const [messageId, message] of this.messages.entries()) {
      if (message.conversation_id === id && message.firebase_uid === firebaseUid) {
        this.messages.delete(messageId);
      }
    }
    this.persist();
    return true;
  }

  listMessages(conversationId: string, firebaseUid: string) {
    return [...this.messages.values()]
      .filter((row) => row.conversation_id === conversationId && row.firebase_uid === firebaseUid)
      .sort((a, b) => a.created_at_ms - b.created_at_ms);
  }

  appendMessage(input: {
    conversation_id: string;
    firebase_uid: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at_ms?: number;
  }) {
    const message: AgentMessageRecord = {
      id: randomUUID(),
      conversation_id: input.conversation_id,
      firebase_uid: input.firebase_uid,
      role: input.role,
      content: input.content,
      created_at_ms: input.created_at_ms ?? nowMs(),
    };
    this.messages.set(message.id, message);
    const conversation = this.conversations.get(input.conversation_id);
    if (conversation) {
      conversation.updated_at_ms = nowMs();
      this.conversations.set(conversation.id, conversation);
    }
    this.persist();
    return message;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverAgentStore?: AgentStore;
};

export const agentStore = globalStore.__emwaverAgentStore ?? new AgentStore();
globalStore.__emwaverAgentStore = agentStore;
