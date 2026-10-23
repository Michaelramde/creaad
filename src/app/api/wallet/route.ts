import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getWalletSummary } from "@/lib/wallet/repo";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const summary = await getWalletSummary(session.user.id);
  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store" },
  });
}
