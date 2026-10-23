import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { pendingTopupsOlderThan, syncTopup } from "@/lib/payments/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Filet de sécurité des webhooks perdus.
 * Déclenché par Vercel Cron (voir vercel.json) toutes les 2 minutes.
 */
export async function GET(req: Request) {
  const secret = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const pending = await pendingTopupsOlderThan(60);
  const results: Record<string, number> = { credited: 0, already: 0, pending: 0, failed: 0 };

  for (const row of pending) {
    if (!row.reference) continue;
    try {
      const outcome = await syncTopup(row.reference);
      if (outcome.result === "credited") results.credited! += 1;
      else if (outcome.result === "already_credited") results.already! += 1;
      else if (outcome.result === "not_completed") results.pending! += 1;
      else results.failed! += 1;
    } catch (error) {
      console.error("[cron/reconcile] échec", row.reference, error);
      results.failed! += 1;
    }
  }

  return NextResponse.json({
    checked: pending.length,
    results,
    base: env.GP_BASE,
    at: new Date().toISOString(),
  });
}
