import { NextResponse, type NextRequest } from "next/server";

import { getContinualPlatformUrl } from "@/server/env";

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: "moved_to_society",
      redirect_url: new URL("/emwaver/handoff", getContinualPlatformUrl()).toString(),
      detail: "Native EMWaver handoff codes are now issued by the Continual platform.",
    },
    { status: 410 },
  );
}
