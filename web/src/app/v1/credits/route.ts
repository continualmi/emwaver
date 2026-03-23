import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { creditsStore, PRO_MONTHLY_ALLOWANCE_TOKENS, TOPUP_USD_PER_1M_TOKENS } from "@/server/store/credits";
import { entitlementsStore } from "@/server/store/entitlements";

function toIso(ms: number) {
  return new Date(ms).toISOString();
}

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const entitlements = await entitlementsStore.get(identity.uid, identity);
  if (!entitlements.pro_active) {
    return NextResponse.json({
      balance: 0,
      monthlyAllowance: 0,
      resetsAt: null,
      topupUsdPer1MTokens: TOPUP_USD_PER_1M_TOKENS,
      unit: "tokens",
    });
  }

  const credits = await creditsStore.getForUser(identity.uid, identity);
  return NextResponse.json({
    balance: credits.balance_tokens,
    monthlyAllowance: PRO_MONTHLY_ALLOWANCE_TOKENS,
    resetsAt: toIso(credits.period_end_ms),
    topupUsdPer1MTokens: TOPUP_USD_PER_1M_TOKENS,
    unit: "tokens",
  });
}
