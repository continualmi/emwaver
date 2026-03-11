import { createHash, randomInt } from "node:crypto";

import { readCollection, writeCollection } from "./jsonStore";

type AuthHandoffRecord = {
  code_hash: string;
  firebase_uid: string;
  created_at_ms: number;
  expires_at_ms: number;
  consumed_at_ms: number | null;
};

function nowMs() {
  return Date.now();
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  for (let index = 0; index < 6; index += 1) {
    body += alphabet[randomInt(0, alphabet.length)];
  }
  return `EMW-${body}`;
}

function hashCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

class AuthHandoffStore {
  private readonly rows = new Map<string, AuthHandoffRecord>(
    Object.entries(readCollection<Record<string, AuthHandoffRecord>>("auth-handoff", {})),
  );

  private persist() {
    writeCollection("auth-handoff", Object.fromEntries(this.rows.entries()));
  }

  issue(firebaseUid: string) {
    for (const [key, row] of this.rows.entries()) {
      if (row.firebase_uid === firebaseUid) {
        this.rows.delete(key);
      }
    }

    const code = randomCode();
    const now = nowMs();
    const record: AuthHandoffRecord = {
      code_hash: hashCode(code),
      firebase_uid: firebaseUid,
      created_at_ms: now,
      expires_at_ms: now + 10 * 60 * 1000,
      consumed_at_ms: null,
    };
    this.rows.set(record.code_hash, record);
    this.persist();
    return { code, expires_at_ms: record.expires_at_ms };
  }

  consume(code: string) {
    const record = this.rows.get(hashCode(code));
    const now = nowMs();
    if (!record) return { error: "invalid_code" } as const;
    if (record.consumed_at_ms) return { error: "already_consumed" } as const;
    if (record.expires_at_ms < now) return { error: "expired" } as const;

    record.consumed_at_ms = now;
    this.rows.set(record.code_hash, record);
    this.persist();
    return { firebase_uid: record.firebase_uid } as const;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverAuthHandoffStore?: AuthHandoffStore;
};

export const authHandoffStore = globalStore.__emwaverAuthHandoffStore ?? new AuthHandoffStore();
globalStore.__emwaverAuthHandoffStore = authHandoffStore;
