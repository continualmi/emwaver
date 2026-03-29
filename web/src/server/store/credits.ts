import {
  CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS,
  TOPUP_USD_PER_1M_TOKENS,
  ensureSharedWalletAllowance,
  ensurePlatformUser,
  getWalletSummary,
} from "@/server/platformCore";

export { CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS as PRO_MONTHLY_ALLOWANCE_TOKENS, TOPUP_USD_PER_1M_TOKENS };

export type CreditRecord = {
  balance_tokens: number;
  monthly_allowance_tokens: number;
  period_start_ms: number | null;
  period_end_ms: number | null;
  updated_at_ms: number;
};

function nowMs() {
  return Date.now();
}

class CreditsStore {
  async getForUser(firebaseUid: string, identity?: { email?: string | null; displayName?: string | null }) {
    const user = await ensurePlatformUser({
      firebaseUid,
      email: identity?.email ?? null,
      displayName: identity?.displayName ?? null,
    });
    await ensureSharedWalletAllowance(user.id);
    const wallet = await getWalletSummary(user.id);
    return {
      balance_tokens: wallet.balance,
      monthly_allowance_tokens: wallet.monthlyAllowance,
      period_start_ms: null,
      period_end_ms: wallet.resetsAt ? new Date(wallet.resetsAt).getTime() : null,
      updated_at_ms: nowMs(),
    };
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverCreditsStore?: CreditsStore;
};

export const creditsStore = globalStore.__emwaverCreditsStore ?? new CreditsStore();
globalStore.__emwaverCreditsStore = creditsStore;
