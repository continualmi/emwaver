import { readCollection, writeCollection } from "./jsonStore";

export const PRO_MONTHLY_ALLOWANCE_TOKENS = 10_000_000;
export const TOPUP_USD_PER_1M_TOKENS = 1;

export type CreditRecord = {
  balance_tokens: number;
  period_start_ms: number;
  period_end_ms: number;
  updated_at_ms: number;
};

function nowMs() {
  return Date.now();
}

class CreditsStore {
  private readonly rows = new Map<string, CreditRecord>(
    Object.entries(readCollection<Record<string, CreditRecord>>("credits", {})),
  );

  private persist() {
    writeCollection("credits", Object.fromEntries(this.rows.entries()));
  }

  getForUser(firebaseUid: string) {
    const now = nowMs();
    const existing = this.rows.get(firebaseUid);
    if (!existing) {
      const record: CreditRecord = {
        balance_tokens: PRO_MONTHLY_ALLOWANCE_TOKENS,
        period_start_ms: now,
        period_end_ms: now + 30 * 24 * 60 * 60 * 1000,
        updated_at_ms: now,
      };
      this.rows.set(firebaseUid, record);
      this.persist();
      return record;
    }

    if (existing.period_end_ms <= now) {
      existing.period_start_ms = now;
      existing.period_end_ms = now + 30 * 24 * 60 * 60 * 1000;
      existing.balance_tokens = PRO_MONTHLY_ALLOWANCE_TOKENS;
      existing.updated_at_ms = now;
      this.rows.set(firebaseUid, existing);
      this.persist();
    }

    return existing;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverCreditsStore?: CreditsStore;
};

export const creditsStore = globalStore.__emwaverCreditsStore ?? new CreditsStore();
globalStore.__emwaverCreditsStore = creditsStore;
