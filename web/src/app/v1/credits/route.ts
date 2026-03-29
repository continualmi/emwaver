import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { creditsStore, TOPUP_USD_PER_1M_TOKENS } from "@/server/store/credits";

function toIso(ms: number | null) {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const credits = await creditsStore.getForUser(identity.uid, identity);
  return NextResponse.json({
    balance: credits.balance_tokens,
    monthlyAllowance: credits.monthly_allowance_tokens,
    resetsAt: toIso(credits.period_end_ms),
    topupUsdPer1MTokens: TOPUP_USD_PER_1M_TOKENS,
    unit: "tokens",
  });
}
