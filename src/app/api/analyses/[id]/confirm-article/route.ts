import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses, sourceListings } from "@/lib/db/schema";

const bodySchema = z.object({
  listingUrl: z.url().optional(),
  note: z.string().max(500).optional(),
});

/**
 * Déblocage manuel après `bloquee_article`.
 *
 * L'utilisateur affirme que l'article est le bon. On ne libère **pas** la
 * réservation : le crédit reste engagé pour les kits à venir. La décision
 * est tracée (`manual_confirmed_at`) — le score, lui, n'est pas réécrit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }

  const [analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!analysis) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (analysis.status !== "bloquee_article") {
    return NextResponse.json(
      { error: "NOT_BLOCKED", status: analysis.status },
      { status: 409 },
    );
  }

  if (parsed.data.listingUrl) {
    await db
      .insert(sourceListings)
      .values({
        provider: "manuel",
        externalId: parsed.data.listingUrl,
        url: parsed.data.listingUrl,
        payload: { note: parsed.data.note ?? null, confirmedBy: session.user.id },
      })
      .onConflictDoNothing();
  }

  await db
    .update(analyses)
    .set({
      status: "appariement",
      manualConfirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(analyses.id, analysis.id));

  return NextResponse.json({
    analysisId: analysis.id,
    status: "appariement",
    manuallyConfirmed: true,
    next: "BUILD_PLAN",
  });
}
