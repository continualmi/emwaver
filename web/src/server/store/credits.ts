import {
  CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS,
  TOPUP_USD_PER_1M_TOKENS,
  ensurePlatformUser,
  getWalletSummary,
  importLegacyWalletState,
} from "@/server/platformCore";
import { readCollection, writeCollection } from "./jsonStore";

export { CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS as PRO_MONTHLY_ALLOWANCE_TOKENS, TOPUP_USD_PER_1M_TOKENS };

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

  private getLegacy(uid: string) {
    const now = nowMs();
    const existing = this.rows.get(uid);
    if (!existing) {
      const record: CreditRecord = {
        balance_tokens: CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS,
        period_start_ms: now,
        period_end_ms: now + 30 * 24 * 60 * 60 * 1000,
        updated_at_ms: now,
      };
      this.rows.set(uid, record);
      this.persist();
      return record;
    }

    if (existing.period_end_ms <= now) {
      existing.period_start_ms = now;
      existing.period_end_ms = now + 30 * 24 * 60 * 60 * 1000;
      existing.balance_tokens = CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS;
      existing.updated_at_ms = now;
      this.rows.set(uid, existing);
      this.persist();
    }

    return existing;
  }

  async getForUser(firebaseUid: string, identity?: { email?: string | null; displayName?: string | null }) {
    const user = await ensurePlatformUser({
      firebaseUid,
      email: identity?.email ?? null,
      displayName: identity?.displayName ?? null,
    });
    const wallet = await getWalletSummary(user.id);
    if (wallet.balance > 0 || wallet.monthlyAllowance > 0 || wallet.resetsAt) {
      return {
        balance_tokens: wallet.balance,
        period_start_ms: 0,
        period_end_ms: wallet.resetsAt ? new Date(wallet.resetsAt).getTime() : 0,
        updated_at_ms: nowMs(),
      };
    }

    const legacy = this.getLegacy(firebaseUid);
    await importLegacyWalletState({
      userId: user.id,
      balanceTokens: legacy.balance_tokens,
      periodStartMs: legacy.period_start_ms,
      periodEndMs: legacy.period_end_ms,
      sourceRef: `legacy_wallet:${firebaseUid}:${legacy.updated_at_ms}`,
      metadata: {
        firebaseUid,
        source: "emwaver_json",
      },
    });
    return legacy;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverCreditsStore?: CreditsStore;
};

export const creditsStore = globalStore.__emwaverCreditsStore ?? new CreditsStore();
globalStore.__emwaverCreditsStore = creditsStore;
