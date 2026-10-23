import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await ctx.params;

  const [row] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    status: row.status,
    country: row.country,
    archetypeSlug: row.archetypeSlug,
    matchScore: row.matchScore,
    matchCoverage: row.matchCoverage,
    failureCode: row.failureCode,
    manuallyConfirmed: row.manualConfirmedAt !== null,
    reservedXof: row.reservedXof,
    settledXof: row.settledXof,
    createdAt: row.createdAt,
  });
}
