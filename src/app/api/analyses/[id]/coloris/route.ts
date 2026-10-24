import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** Identifiants des valeurs de coloris retenues. */
  selected: z.array(z.string()).max(50),
});

/**
 * Coloris vendus — une décision, pas un filtre d'affichage.
 *
 * Elle est enregistrée pour que la galerie, la fiche et l'export disent tous
 * la même chose, même après avoir fermé la page.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const [analysis] = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!analysis) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await db
    .update(analyses)
    .set({ selectedVariants: parsed.data.selected, updatedAt: new Date() })
    .where(eq(analyses.id, id));

  return NextResponse.json({ selected: parsed.data.selected });
}
