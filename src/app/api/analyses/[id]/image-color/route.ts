import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";

export const runtime = "nodejs";

const bodySchema = z.object({
  url: z.string().url(),
  /** Identifiant du coloris, ou `null` pour « cette image ne montre aucun coloris ». */
  valueId: z.string().nullable(),
});

/**
 * Corriger le coloris d'une image.
 *
 * Le modèle hésite parfois entre deux teintes proches — sac brun-orangé,
 * lumière changeante. Le commerçant tranche, et sa décision l'emporte sur le
 * classement automatique, y compris dans l'export.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const [analysis] = await db
    .select({ id: analyses.id, corrections: analyses.imageCorrections })
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!analysis) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const next = { ...(analysis.corrections ?? {}), [parsed.data.url]: parsed.data.valueId };

  await db
    .update(analyses)
    .set({ imageCorrections: next, updatedAt: new Date() })
    .where(eq(analyses.id, id));

  return NextResponse.json({ corrections: next });
}
